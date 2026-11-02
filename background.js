// "{ip}" placeholder will be replaced at runtime.
// Order: verified working + fast first. Dead/key-required providers were removed (v2).
const DEFAULT_ENDPOINTS = [
  "http://ip-api.com/json/{ip}",
  "https://ipwho.is/{ip}",
  "https://ipinfo.io/{ip}/json",
  "https://api.ip.sb/geoip/{ip}",
  "https://api.iplocation.net/?ip={ip}",
  "https://api.db-ip.com/v2/free/{ip}",
  "http://ipwhois.app/json/{ip}",
  "https://ipapi.com/ip_api.php?ip={ip}",
  "https://freeipapi.com/api/json/{ip}",
  "https://ipapi.co/{ip}/json/"
];
const ENDPOINTS_VERSION = 2;
// v1 leftovers that never worked (timeouts / API-key required / dead)
const DROPPED_ENDPOINTS = [
  "https://ip.nf/{ip}.json",
  "https://extreme-ip-lookup.com/json/{ip}",
  "https://ip.seeip.org/geoip/{ip}",
  "https://geo.ipify.org/api/v2/country,city?apiKey=at_demo&ipAddress={ip}",
  "https://ipgeolocation.abstractapi.com/v1/?api_key=demo&ip_address={ip}",
  "https://ipgeolocation.io/ip-location/{ip}?apiKey=free",
  "https://ipstack.com/ipstack_api.php?ip={ip}&access_key=free",
  "https://ipapi.es/{ip}"
];

/* ---------- Storage Helpers ---------- */
async function getEndpointList() {
  const { endpoints, endpointsV } = await chrome.storage.local.get(["endpoints", "endpointsV"]);
  const fixHttp = (u) =>
    (typeof u === "string" && u.startsWith("https://ip-api.com/"))
      ? u.replace("https://ip-api.com/", "http://ip-api.com/")
      : u;
  if (Array.isArray(endpoints) && endpoints.length) {
    let list = endpoints.map(fixHttp);
    if ((endpointsV || 0) < ENDPOINTS_VERSION) {
      // drop dead entries, keep the user's order, append newly added providers
      const kept = list.filter((u) => !DROPPED_ENDPOINTS.includes(u));
      const additions = DEFAULT_ENDPOINTS.filter((u) => !kept.includes(u));
      list = [...kept, ...additions];
      await chrome.storage.local.set({ endpoints: list, endpointsV: ENDPOINTS_VERSION });
    }
    return list;
  }
  // first-run: persist defaults
  await chrome.storage.local.set({ endpoints: DEFAULT_ENDPOINTS, endpointsV: ENDPOINTS_VERSION });
  return DEFAULT_ENDPOINTS;
}

/* ---------- Lookup Logic ---------- */
async function normalizeResponse(raw, url) {
  if (!raw || typeof raw !== "object") return null;
  const normalized = {
    ip:
      raw.ip ||
      raw.query ||
      raw.ip_address ||
      raw.ipAddress ||
      raw.IP ||
      raw.data?.ip ||
      "Unknown",
    // ISO-2 country code for flag
    countryCode:
      raw.countryCode ||
      raw.country_code ||
      raw.data?.country_code ||
      (typeof raw.country === "string" && raw.country.length === 2 ? raw.country : null),
    country:
      (typeof raw.country === "string" && raw.country.length > 2 ? raw.country : null) ||
      raw.countryName ||
      raw.country_name ||
      (typeof raw.country === "string" ? raw.country : null) ||
      raw.countryCode ||
      raw.country_code ||
      raw.data?.country ||
      "Unknown",
    region:
      raw.region ||
      raw.regionName ||
      raw.region_name ||
      raw.state ||
      raw.stateProv ||
      "Unknown",
    city: raw.city || raw.cityName || raw.data?.city || "Unknown",
    org:
      raw.org ||
      raw.isp ||
      raw.organization ||
      raw.asnOrganization ||
      raw.connection?.organization ||
      raw.connection?.isp ||
      raw.connection?.org ||
      raw.connection?.organisation ||
      raw.asn ||
      raw.autonomous_system_organization ||
      "Unknown",
    hostname: raw.hostname || null,
    source: url
  };
  return normalized;
}

async function lookupIp(ip) {
  const cached = await chrome.storage.session.get(ip);
  if (cached && cached[ip]) return cached[ip];

  /* ---------- Reverse DNS (hostname) ---------- */
  async function getHostname(ip) {
    try {
      // IPv4 PTR query via Google DNS-over-HTTPS
      if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(ip)) {
        const rev = ip.split(".").reverse().join(".") + ".in-addr.arpa";
        const res = await fetch(
          `https://dns.google/resolve?name=${rev}&type=PTR`
        );
        const json = await res.json();
        if (json.Answer && json.Answer.length) {
          // Find first PTR record with a valid hostname (not just the IP)
          const ptr = json.Answer.find(a => a.type === 12 && a.data && !/in-addr\.arpa/i.test(a.data));
          if (ptr) {
            return ptr.data.replace(/\.$/, "");
          }
          // fallback: first answer, strip trailing dot
          return json.Answer[0].data.replace(/\.$/, "");
        }
      }
    } catch (_) {
      /* ignore errors */
    }
    return null;
  }
  const endpoints = await getEndpointList();
  for (const template of endpoints) {
    const url = template.replace("{ip}", encodeURIComponent(ip));
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    try {
      const res = await fetch(url, { cache: "no-store", signal: ctrl.signal });
      if (!res.ok) continue;
      const data = await res.json();
      if (data && typeof data === "object") {
        if (String(data.status || "").toLowerCase() === "fail") continue;
        if (data.success === false) continue;

        const normalized = await normalizeResponse(data, url);
        if (normalized.country && normalized.country !== "Unknown") {
          // add hostname via reverse DNS (keep provider value if present)
          normalized.hostname = normalized.hostname || (await getHostname(ip));
          await chrome.storage.session.set({ [ip]: normalized });
          return normalized;
        }
      }
    } catch (_) {    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "lookup") {
    if (typeof msg.ip !== "string" || !/^[0-9a-f:.]{2,45}$/i.test(msg.ip.trim())) {
      sendResponse(null);
      return false;
    }
    // always answer, even if a lookup step throws — otherwise the popup waits for its timeout
    lookupIp(msg.ip.trim()).then(sendResponse, () => sendResponse(null));
    return true; // keep channel open
  }
  if (msg?.type === "getEndpoints") {
    getEndpointList().then(list => sendResponse(list));
    return true;
  }
  if (msg?.type === "setEndpoints" && Array.isArray(msg.endpoints)) {
    const endpoints = msg.endpoints.filter(
      (u) => typeof u === "string" && /^https?:\/\/[^\s]+$/i.test(u) && u.includes("{ip}")
    );
    // an empty list would disable lookups entirely — fall back to the defaults
    chrome.storage.local.set({
      endpoints: endpoints.length ? endpoints : DEFAULT_ENDPOINTS,
      endpointsV: ENDPOINTS_VERSION
    }).then(() =>
      sendResponse({ ok: true })
    );
    return true;
  }
  // theme toggle
  if (msg?.type === "getTheme") {
    chrome.storage.local.get("theme").then(({ theme }) =>
      sendResponse(theme || "dark")
    );
    return true;
  }
  if (msg?.type === "setTheme" && (msg.theme === "dark" || msg.theme === "light" || msg.theme === "system")) {
    chrome.storage.local.set({ theme: msg.theme }).then(() =>
      sendResponse({ ok: true })
    );
    return true;
  }
  // ---- ServerIP (MV3 port of jcottrell/ServerIP) ----
  if (msg?.type === "getServerIp") {
    getServerIpForHost(msg.host).then(sendResponse);
    return true;
  }
  if (msg?.type === "getServerIpSettings") {
    getServerIpState().then(sendResponse);
    return true;
  }
  if (msg?.type === "setServerIpSettings") {
    setServerIpState(msg.settings, msg.mnemonics).then(() => sendResponse({ ok: true }));
    return true;
  }
  return false;
});
/* ============================================================
 * ServerIP module — MV3 port of jcottrell/ServerIP
 * Captures the real connection IP via webRequest, shows the
 * last octet / mnemonic in the badge, stores it for the hover overlay.
 * Settings: chrome.storage.local -> { serverIp, mnemonics }
 * ============================================================ */
const DEFAULT_SERVERIP = {
  enabled: true,
  showBadge: true,
  showHover: true,
  hoverCorner: "top-right",
  defaultColor: "#ff9b33"
};
const HOVER_CORNERS = ["top-right", "top-left", "bottom-right", "bottom-left"];
const SERVERIP_MAP_LIMIT = 500;

function sanitizeServerIpSettings(s) {
  const out = {};
  for (const k of ["enabled", "showBadge", "showHover"]) {
    if (typeof s[k] === "boolean") out[k] = s[k];
  }
  if (HOVER_CORNERS.includes(s.hoverCorner)) out.hoverCorner = s.hoverCorner;
  if (typeof s.defaultColor === "string" && /^#[0-9a-f]{6}$/i.test(s.defaultColor)) out.defaultColor = s.defaultColor;
  return out;
}

function parseHost(url) {
  try {
    return new URL(url).hostname || "";
  } catch (_) {
    return "";
  }
}

async function getServerIpState() {
  const { serverIp, mnemonics, serverIpByHost } =
    await chrome.storage.local.get(["serverIp", "mnemonics", "serverIpByHost"]);
  return {
    settings: { ...DEFAULT_SERVERIP, ...(serverIp || {}) },
    mnemonics: mnemonics || {},
    map: serverIpByHost || {}
  };
}

async function setServerIpState(settings, mnemonics) {
  const patch = {};
  if (settings && typeof settings === "object") {
    const cur = (await chrome.storage.local.get("serverIp")).serverIp || {};
    patch.serverIp = { ...DEFAULT_SERVERIP, ...cur, ...sanitizeServerIpSettings(settings) };
  }
  if (mnemonics && typeof mnemonics === "object") {
    patch.mnemonics = mnemonics;
  }
  if (Object.keys(patch).length) await chrome.storage.local.set(patch);
  // badges refresh via storage.onChanged; live overlays hide/show themselves the same way.
  // Inject into open tabs that have no overlay yet (no reload wait); the script dedupes itself.
  await injectHoverIntoOpenTabs().catch(() => {});
}

async function getServerIpForHost(host) {
  if (!host) return { ip: null };
  const { serverIpByHost, mnemonics, serverIp } =
    await chrome.storage.local.get(["serverIpByHost", "mnemonics", "serverIp"]);
  const settings = { ...DEFAULT_SERVERIP, ...(serverIp || {}) };
  if (!settings.enabled) return { ip: null, disabled: true };
  const entry = (serverIpByHost || {})[host];
  const ip = typeof entry === "string" ? entry : entry?.ip || null;
  const mnem = (mnemonics || {})[ip] || null;
  return { ip, ts: entry?.ts || null, mnemonic: mnem, settings };
}

function badgeForIp(ip, mnemonics, defaultColor) {
  if (!ip) return { text: "", color: defaultColor };
  const m = (mnemonics || {})[ip];
  if (m?.mnem) return { text: String(m.mnem).slice(0, 4), color: m.color || defaultColor };
  // IPv4: last octet; IPv6: last non-empty group
  const last = ip.includes(".") ? ip.slice(ip.lastIndexOf(".") + 1) : (ip.split(":").filter(Boolean).pop() || ip);
  return { text: String(last).slice(0, 4), color: defaultColor };
}

async function refreshBadgeForTab(tabId, tabUrl) {
  try {
    const { serverIp, mnemonics } = await chrome.storage.local.get(["serverIp", "mnemonics"]);
    const settings = { ...DEFAULT_SERVERIP, ...(serverIp || {}) };
    if (!settings.enabled || !settings.showBadge) {
      await chrome.action.setBadgeText({ text: "", tabId }).catch(() => chrome.action.setBadgeText({ text: "" }));
      return;
    }
    let url = tabUrl;
    if (!url) {
      const tab = await chrome.tabs.get(tabId).catch(() => null);
      url = tab?.url;
    }
    const host = url ? parseHost(url) : "";
    if (!host) {
      await chrome.action.setBadgeText({ text: "", tabId }).catch(() => {});
      return;
    }
    const { ip } = await getServerIpForHost(host);
    const { text, color } = badgeForIp(ip, mnemonics, settings.defaultColor);
    await chrome.action.setBadgeText({ text, tabId }).catch(() => chrome.action.setBadgeText({ text }));
    if (color) await chrome.action.setBadgeBackgroundColor({ color, tabId }).catch(() => chrome.action.setBadgeBackgroundColor({ color }));
  } catch (_) { /* ignore */ }
}

async function refreshCurrentTabBadge() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []);
  if (tab?.id) await refreshBadgeForTab(tab.id, tab.url);
}

// Badges are per tab: settings/mnemonic changes must reach every tab, not just the active one.
async function refreshAllBadges() {
  const tabs = await chrome.tabs.query({}).catch(() => []);
  await Promise.all(tabs.filter((t) => t.id != null).map((t) => refreshBadgeForTab(t.id, t.url)));
}

// Hover overlay: inject into tabs that are already open.
// Manifest content scripts only run on (re)load, so tabs open
// during install/startup would otherwise stay empty.
// force: inject even when the overlay is off — after an update/reload the old copies
// in open tabs are orphaned and can't hide themselves; the fresh copy removes them.
async function injectHoverIntoOpenTabs(force = false) {
  try {
    if (!chrome.scripting?.executeScript) return;
    const { serverIp } = await chrome.storage.local.get("serverIp");
    const s = { ...DEFAULT_SERVERIP, ...(serverIp || {}) };
    if (!force && (!s.enabled || !s.showHover)) return;
    const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] }).catch(() => []);
    for (const t of tabs) {
      if (t.id == null || t.discarded) continue;
      chrome.scripting.executeScript({
        target: { tabId: t.id, allFrames: false },
        files: ["content/hover-box.js"]
      }).catch(() => {});
    }
  } catch (_) { /* ignore */ }
}

// Read-modify-write of serverIpByHost is serialized: parallel page loads
// in several tabs would otherwise overwrite each other's entries.
let serverIpWriteChain = Promise.resolve();

async function recordServerIp(details) {
  const { serverIp, serverIpByHost } =
    await chrome.storage.local.get(["serverIp", "serverIpByHost"]);
  const settings = { ...DEFAULT_SERVERIP, ...(serverIp || {}) };
  if (!settings.enabled) return;
  const host = parseHost(details.url);
  if (!host) return;
  const map = serverIpByHost || {};
  map[host] = { ip: details.ip, ts: Date.now() };
  // LRU prune
  const keys = Object.keys(map);
  if (keys.length > SERVERIP_MAP_LIMIT) {
    const sorted = keys.sort((a, b) => (map[a]?.ts || 0) - (map[b]?.ts || 0));
    for (let i = 0; i < keys.length - SERVERIP_MAP_LIMIT; i++) delete map[sorted[i]];
  }
  await chrome.storage.local.set({ serverIpByHost: map });
  if (details.tabId >= 0) await refreshBadgeForTab(details.tabId, details.url);
}

// Real IP capture: details.ip arrives on main_frame completion
try {
  if (chrome.webRequest?.onCompleted) {
    chrome.webRequest.onCompleted.addListener(
      (details) => {
        if (!details?.ip || !details?.url) return;
        serverIpWriteChain = serverIpWriteChain
          .then(() => recordServerIp(details))
          .catch(() => { /* ignore */ });
      },
      { urls: ["<all_urls>"], types: ["main_frame"] }
    );
  }
} catch (_) { /* webRequest yoksa sessiz gec */ }

try {
  chrome.tabs?.onUpdated?.addListener((tabId, info, tab) => {
    if (info.status === "complete" || info.url) refreshBadgeForTab(tabId, tab?.url);
  });
  chrome.tabs?.onActivated?.addListener((a) => refreshBadgeForTab(a.tabId));
  chrome.windows?.onFocusChanged?.addListener(() => refreshCurrentTabBadge());
  chrome.runtime?.onInstalled?.addListener(() => injectHoverIntoOpenTabs(true));
  chrome.runtime?.onStartup?.addListener(() => injectHoverIntoOpenTabs());
  chrome.storage?.onChanged?.addListener((changes, area) => {
    if (area === "local" && (changes.serverIp || changes.mnemonics)) refreshAllBadges();
  });
} catch (_) { /* ignore */ }