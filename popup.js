/* DNSRator popup — v2.2 */
"use strict";

function showError(msg) {
  const box = document.getElementById("error-box");
  if (box) {
    box.hidden = false;
    box.classList.remove("notice");
    box.textContent = "Error: " + msg;
  }
  console.error("[DNSRator]", msg);
}
// Hata degil, bilgi mesaji (chrome://, file://, IP adresi vb.)
function showNotice(msg) {
  const box = document.getElementById("error-box");
  if (box) {
    box.hidden = false;
    box.classList.add("notice");
    box.textContent = msg;
  }
}

function copyText(text, btn) {
  if (text == null || text === "") return;
  text = String(text);
  const done = () => {
    if (!btn) return;
    // ilk orijinal ikonu sakla; hizli cift tiklamada "check" ikonunda takili kalmasin
    if (btn.dataset.origHtml == null) btn.dataset.origHtml = btn.innerHTML;
    btn.innerHTML = '<i class="fa fa-check"></i>';
    clearTimeout(btn._copyTimer);
    btn._copyTimer = setTimeout(() => { btn.innerHTML = btn.dataset.origHtml; }, 1200);
  };
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
  } else fallbackCopy(text, done);
}
function fallbackCopy(text, done) {
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    if (ok) done?.();
  } catch (_) { /* ignore */ }
}

// Background mesaji; cevap gelmezse (SW hata/uyku) timeout ile null doner, UI asili kalmaz
const send = (msg, ms = 5000) => new Promise((res) => {
  let settled = false;
  const finish = (v) => { if (!settled) { settled = true; clearTimeout(timer); res(v); } };
  const timer = setTimeout(() => finish(null), ms);
  try {
    chrome.runtime.sendMessage(msg, (r) => {
      void chrome.runtime.lastError; // "Unchecked runtime.lastError" uyarisini bastir
      finish(r ?? null);
    });
  } catch (_) { finish(null); }
});

const isIPv4 = (s) => /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/.test(String(s));

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = String(text);
  return e;
}

// --- DNS-over-HTTPS (Google) ---
const DOH_URL = "https://dns.google/resolve";
const TYPE_NUM = { A: 1, NS: 2, CNAME: 5, PTR: 12, MX: 15, TXT: 16, AAAA: 28 };
async function doh(name, type, extra) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const qs = new URLSearchParams({ name: String(name), type: String(type), ...(extra || {}) });
    const res = await fetch(`${DOH_URL}?${qs}`, { signal: ctrl.signal });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const js = await res.json();
    return js && typeof js === "object" ? js : null;
  } catch (e) {
    console.warn(`[DNSRator] DoH ${type} ${name} failed:`, e?.message || e);
    return null;
  } finally { clearTimeout(timer); }
}
function answersOf(data, typeNum) {
  const ans = Array.isArray(data?.Answer) ? data.Answer : [];
  return ans.filter((a) => a && a.data != null && (typeNum == null || a.type === typeNum));
}

// --- DNS blacklists: providers verified to answer via dns.google (see checkBlacklist) ---
const listedCode = (min = 2, max = 254) => (v) => {
  const m = /^127\.0\.0\.(\d{1,3})$/.exec(v);
  return !!m && +m[1] >= min && +m[1] <= max;
};
const DNSBLS = [
  { name: "SpamCop", zone: "bl.spamcop.net" },
  { name: "Barracuda", zone: "b.barracudacentral.org" },
  { name: "PSBL", zone: "psbl.surriel.com" },
  { name: "UCEPROTECT L1", zone: "dnsbl-1.uceprotect.net" },
  { name: "Mailspike", zone: "bl.mailspike.net", listed: listedCode(2, 2) }, // 127.0.0.10-14 = reputation, not a listing
  { name: "DroneBL", zone: "dnsbl.dronebl.org", listed: listedCode(1) },
  { name: "Blocklist.de", zone: "bl.blocklist.de" },
  { name: "0spam", zone: "bl.0spam.org" }
];
const MAX_BL_IPS = 4;

document.addEventListener("DOMContentLoaded", async () => {
  window.addEventListener("error", (e) => showError(e.message));

  // --- Elements ---
  const loader = document.querySelector(".loader");
  const hideLoader = () => { if (loader) loader.style.display = "none"; };
  const currentSite = document.getElementById("current-site");
  const copySiteBtn = document.getElementById("copy-site");
  const mainTabs = document.querySelectorAll(".main-tabs > .tab[data-tab]");
  const dnsSection = document.getElementById("dns-section");
  const ipSection = document.getElementById("ip-section");
  const themeToggle = document.getElementById("theme-toggle");
  const favToggle = document.getElementById("fav-toggle");
  const blacklistIndicator = document.getElementById("blacklist-indicator");
  const openSettingsBtn = document.getElementById("open-settings");
  const dnsTabs = document.querySelectorAll(".inner-tabs .tab");
  const recordBoxes = document.querySelectorAll(".dns-records .record-box");
  const countElements = {
    a: document.getElementById("a-count"),
    www: document.getElementById("www-count"),
    ns: document.getElementById("ns-count"),
    mx: document.getElementById("mx-count"),
    txt: document.getElementById("txt-count"),
    ptr: document.getElementById("ptr-count")
  };
  const ipInput = document.getElementById("ip-input");
  const lookupBtn = document.getElementById("lookup-btn");
  const ipResult = document.getElementById("ip-result");
  const sipCard = document.getElementById("sip-card");
  const sipIp = document.getElementById("sip-ip");
  const sipMnem = document.getElementById("sip-mnem");
  const sipCopy = document.getElementById("sip-copy");
  const sipHint = document.getElementById("sip-hint");

  // --- Tema: tek kaynak chrome.storage.local ("dark"|"light"|"system") ---
  const normTheme = (m) => (m === "dark" || m === "light" || m === "system" ? m : null);
  const darkMq = window.matchMedia?.("(prefers-color-scheme: dark)");
  function resolveTheme(mode) {
    if (mode === "light") return false;
    if (mode === "dark") return true;
    return darkMq ? darkMq.matches : true;
  }
  function paintTheme(mode) {
    const isDark = resolveTheme(mode);
    document.body.classList.toggle("dark-theme", isDark);
    document.documentElement.setAttribute("data-theme", isDark ? "dark" : "light");
    if (themeToggle) themeToggle.textContent = isDark ? "☾" : "☀";
  }
  async function loadTheme() {
    let mode = normTheme(await send({ type: "getTheme" }, 2000));
    if (!mode) {
      try { mode = normTheme(localStorage.getItem("dnsRecordsTheme")) || "dark"; } catch (_) { mode = "dark"; }
    }
    paintTheme(mode);
    return mode;
  }
  let themeMode = await loadTheme();
  themeToggle?.addEventListener("click", async () => {
    themeMode = resolveTheme(themeMode) ? "light" : "dark";
    paintTheme(themeMode);
    try { localStorage.setItem("dnsRecordsTheme", themeMode); } catch (_) {}
    await send({ type: "setTheme", theme: themeMode });
  });
  try {
    darkMq?.addEventListener?.("change", () => {
      if (themeMode === "system") paintTheme("system");
    });
  } catch (_) {}

  openSettingsBtn?.addEventListener("click", () => {
    try { chrome.runtime.openOptionsPage(); } catch (_) {}
  });

  // --- Ana sekme gecisi (DNS / IP) ---
  const allSections = { dns: dnsSection, ip: ipSection };
  function activateMainTab(name) {
    mainTabs.forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
    Object.keys(allSections).forEach((k) => allSections[k]?.classList.toggle("active", k === name));
  }
  mainTabs.forEach((tab) => tab.addEventListener("click", () => activateMainTab(tab.dataset.tab)));

  // --- DNS ic sekme gecisi ---
  dnsTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      dnsTabs.forEach((t) => t.classList.remove("active"));
      recordBoxes.forEach((b) => b.classList.remove("active"));
      tab.classList.add("active");
      document.getElementById(tab.dataset.tab + "-records")?.classList.add("active");
    });
  });

  // --- IP lookup history (recent chips, one-click re-query) ---
  // (IP lookup, aktif sekme http(s) olmasa da calissin diye DNS kisminin ONUNDE kuruluyor)
  const IP_HIST_KEY = "dnsrator_ip_history";
  const IP_HIST_MAX = 8;
  const histBox = document.getElementById("ip-history");
  const histClear = document.getElementById("ip-history-clear");
  function readIpHistory() {
    try {
      const v = JSON.parse(localStorage.getItem(IP_HIST_KEY) || "[]");
      return Array.isArray(v) ? v.filter((h) => h && typeof h.ip === "string" && h.ip) : [];
    } catch (_) { return []; }
  }
  function pushIpHistory(ip, info) {
    const hist = readIpHistory().filter((h) => h.ip !== ip);
    hist.unshift({ ip, country: typeof info?.country === "string" ? info.country : "", ts: Date.now() });
    try { localStorage.setItem(IP_HIST_KEY, JSON.stringify(hist.slice(0, IP_HIST_MAX))); } catch (_) {}
    renderIpHistory();
  }
  function renderIpHistory() {
    if (!histBox) return;
    const hist = readIpHistory();
    histBox.textContent = "";
    if (histClear) histClear.style.display = hist.length ? "" : "none";
    if (histBox.parentElement) histBox.parentElement.hidden = !hist.length;
    hist.forEach(({ ip, country }) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "recent-chip";
      b.textContent = country ? `${ip} · ${country}` : ip;
      b.title = "Query again";
      b.addEventListener("click", () => {
        if (!ipInput || !lookupBtn) return;
        ipInput.value = ip;
        activateMainTab("ip");
        lookupBtn.click();
      });
      histBox.appendChild(b);
    });
  }
  histClear?.addEventListener("click", () => {
    try { localStorage.removeItem(IP_HIST_KEY); } catch (_) {}
    renderIpHistory();
  });
  renderIpHistory();

  // --- IP Lookup ---
  function renderIpResult(info) {
    if (!ipResult) return;
    ipResult.textContent = "";
    if (!info || typeof info !== "object") {
      const es = el("div", "empty-state");
      es.appendChild(el("i", "fa fa-circle-exclamation"));
      es.appendChild(el("p", null, "No IP information found."));
      ipResult.appendChild(es);
      return;
    }
    const v = (x) => (x == null || x === "" ? "—" : String(x));
    const card = el("div", "ipscan-card");
    const head = el("div", "ipscan-card-header");
    // Sadece gecerli 2 harfli ulke kodu ile bayrak iste ("Unknown", null, "un" gibi copler istek uretmesin)
    const cc = String(info.countryCode || "").trim().toLowerCase();
    if (/^[a-z]{2}$/.test(cc) && cc !== "xx" && cc !== "zz") {
      const flagHosts = [
        `https://flagcdn.com/24x18/${cc}.png`,
        `https://cdn.jsdelivr.net/npm/svg-country-flags@1.2.10/png100px/${cc}.png`,
        `https://cdnjs.cloudflare.com/ajax/libs/flag-icon-css/4.1.7/flags/4x3/${cc}.svg`,
        `https://flagicons.lipis.dev/flags/4x3/${cc}.svg`,
        `https://hatscripts.github.io/circle-flags/flags/${cc}.svg`,
        `https://raw.githubusercontent.com/lipis/flag-icons/main/flags/4x3/${cc}.svg`,
        `https://flagcdn.com/48x36/${cc}.png`,
        `https://flagsapi.com/${cc.toUpperCase()}/flat/24.png`,
        `https://www.geonames.org/flags/x/${cc}.gif`,
        `https://flagpedia.net/data/flags/normal/${cc}.png`
      ];
      const img = el("img", "ipscan-flag");
      img.alt = "";
      let hostIdx = 0;
      img.onerror = () => {
        hostIdx++;
        if (hostIdx < flagHosts.length) img.src = flagHosts[hostIdx];
        else { img.onerror = null; img.remove(); } // zincir bitti: kirik ikon gosterme
      };
      img.src = flagHosts[0];
      head.appendChild(img);
    }
    head.appendChild(el("div", "ipscan-ip", v(info.ip)));
    card.appendChild(head);
    if (info.hostname) {
      const hn = el("div", "ipscan-hostname");
      hn.appendChild(el("strong", null, "Hostname:"));
      hn.appendChild(document.createTextNode(" " + String(info.hostname)));
      card.appendChild(hn);
    }
    const infoBox = el("div", "ipscan-info");
    [["Country:", info.country], ["Region:", info.region], ["City:", info.city], ["Org:", info.org]].forEach(([k, val]) => {
      const row = el("span");
      row.appendChild(el("strong", null, k));
      row.appendChild(document.createTextNode(" " + v(val)));
      infoBox.appendChild(row);
    });
    card.appendChild(infoBox);
    let src = info.source;
    try { src = new URL(info.source).hostname; } catch (_) {}
    card.appendChild(el("div", "ipscan-source", "Source: " + v(src)));
    ipResult.appendChild(card);
  }

  if (lookupBtn && ipInput && ipResult) {
    lookupBtn.addEventListener("click", async () => {
      const ip = ipInput.value.trim().replace(/^\[(.*)\]$/, "$1");
      if (!ip || lookupBtn.disabled) return;
      lookupBtn.disabled = true;
      ipResult.innerHTML = '<div class="skel"></div><div class="skel"></div><div class="skel"></div>';
      try {
        // Background saglayicilari sirayla 10s timeout ile dener; cevap hic gelmezse 60s sonra vazgec
        const info = await send({ type: "lookup", ip }, 60000);
        renderIpResult(info);
        if (info) pushIpHistory(ip, info);
      } catch (_) {
        renderIpResult(null);
      } finally {
        lookupBtn.disabled = false;
      }
    });
    ipInput.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing) lookupBtn.click(); });
  }

  // --- Blacklist pill ---
  function setPill(state, text, title) {
    if (!blacklistIndicator) return;
    const map = {
      clean: ["avail", "Clean", "Not listed in any checked blacklist"],
      listed: ["err", "Listed", "Listed in a blacklist!"],
      unknown: ["unk", "Unknown", "Blacklist check unavailable (no provider answered)"],
      na: ["unk", "N/A", "No IPv4 address to check against blacklists"]
    };
    const [cls, defText, defTitle] = map[state] || map.unknown;
    blacklistIndicator.className = "badge " + cls;
    blacklistIndicator.textContent = text || defText;
    blacklistIndicator.title = title || defTitle;
  }

  // --- Aktif sekme ---
  if (typeof chrome === "undefined" || !chrome.tabs?.query) {
    showError("Chrome extension APIs are unavailable.");
    setPill("na");
    hideLoader();
    return;
  }
  let tabUrl = "";
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    tabUrl = tab?.url || tab?.pendingUrl || "";
    if (!tabUrl) throw new Error("Active tab could not be read.");
  } catch (e) { showError(e?.message || String(e)); setPill("na"); hideLoader(); return; }

  let url = null;
  try { url = new URL(tabUrl); } catch (_) {}
  if (!url || !/^https?:$/.test(url.protocol) || !url.hostname) {
    const scheme = url ? url.protocol.replace(/:$/, "") : "";
    if (currentSite) currentSite.textContent = scheme ? `${scheme}:// page` : "—";
    showNotice("No DNS to resolve on this page — open an http(s) site. IP lookup still works.");
    setPill("na");
    if (favToggle) favToggle.disabled = true;
    if (copySiteBtn) copySiteBtn.disabled = true;
    hideLoader();
    return;
  }

  // rawHost: webRequest/background ile ayni anahtar (serverIpByHost). Gosterim/DNS icin normalize edilir.
  const rawHost = url.hostname;
  const displayHostname = rawHost.replace(/\.+$/, "").toLowerCase();
  let ipLiteral = null;
  if (/^\[.*\]$/.test(displayHostname)) ipLiteral = displayHostname.slice(1, -1);
  else if (isIPv4(displayHostname)) ipLiteral = displayHostname;
  // "www." yalnizca geriye en az bir nokta kalirsa at (www.com -> "com" olmasin)
  const hostname = displayHostname.startsWith("www.") && displayHostname.slice(4).includes(".")
    ? displayHostname.slice(4) : displayHostname;

  if (currentSite) currentSite.textContent = displayHostname;
  copySiteBtn?.addEventListener("click", () => copyText(displayHostname, copySiteBtn));

  // --- Favori yildizi ---
  const favKey = "dnsFavorites";
  const readFav = () => {
    try {
      const v = JSON.parse(localStorage.getItem(favKey) || "[]");
      return Array.isArray(v) ? v.filter((d) => typeof d === "string") : [];
    } catch (_) { return []; }
  };
  function paintFav() {
    const isFav = readFav().includes(displayHostname);
    favToggle?.classList.toggle("active", isFav);
    const icon = favToggle?.querySelector("i");
    if (icon) icon.className = isFav ? "fa-solid fa-star" : "fa-regular fa-star";
    if (favToggle) favToggle.title = isFav ? "Remove from favorites" : "Add to favorites";
  }
  paintFav();
  favToggle?.addEventListener("click", () => {
    let fav = readFav();
    fav = fav.includes(displayHostname) ? fav.filter((d) => d !== displayHostname) : [...fav, displayHostname];
    try { localStorage.setItem(favKey, JSON.stringify(fav)); } catch (_) {}
    paintFav();
  });

  // --- Server IP card (gercek baglanilan IP, background webRequest'ten) ---
  let dnsAIps = null; // A kayitlari gelince doldurulur (CDN farki notu icin)
  let sipCurrent = null;
  function ago(ts) {
    const s = Math.max(0, Math.round((Date.now() - Number(ts)) / 1000));
    if (!Number.isFinite(s)) return "";
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.round(s / 60)}m ago`;
    if (s < 86400) return `${Math.round(s / 3600)}h ago`;
    return `${Math.round(s / 86400)}d ago`;
  }
  function paintSipHint() {
    if (!sipHint) return;
    const r = sipCurrent;
    if (!r?.ip) { sipHint.textContent = "not captured yet — reload the page"; return; }
    const parts = [];
    const seen = r.ts ? ago(r.ts) : "";
    if (seen) parts.push("seen " + seen);
    if (Array.isArray(dnsAIps) && isIPv4(r.ip)) {
      parts.push(dnsAIps.includes(r.ip) ? "matches DNS A record" : "differs from DNS A records (CDN/proxy)");
    } else parts.push("may differ from DNS A records (CDN)");
    sipHint.textContent = parts.join(" · ");
  }
  async function loadServerIp() {
    if (!sipCard) return;
    const r = await send({ type: "getServerIp", host: rawHost }, 3000);
    if (!r || typeof r !== "object" || r.disabled) { sipCard.hidden = true; sipCurrent = null; return; }
    sipCurrent = r;
    sipCard.hidden = false;
    const ip = typeof r.ip === "string" && r.ip ? r.ip : null;
    if (sipIp) sipIp.textContent = ip || "—";
    if (sipCopy) sipCopy.hidden = !ip;
    if (sipMnem) {
      const m = ip && r.mnemonic && r.mnemonic.mnem ? r.mnemonic : null;
      sipMnem.hidden = !m;
      sipMnem.textContent = m ? String(m.mnem) : "";
      sipMnem.style.color = "";
      sipMnem.style.borderColor = "";
      if (m?.color) { sipMnem.style.color = String(m.color); sipMnem.style.borderColor = String(m.color); }
    }
    paintSipHint();
  }
  sipCopy?.addEventListener("click", () => copyText(sipCurrent?.ip, sipCopy));
  loadServerIp();

  try {
    chrome.storage?.onChanged?.addListener((ch, area) => {
      if (area !== "local") return;
      if (ch.theme) { themeMode = normTheme(ch.theme.newValue) || "dark"; paintTheme(themeMode); }
      if (ch.serverIpByHost || ch.mnemonics || ch.serverIp) loadServerIp();
    });
  } catch (_) {}

  // --- IP adresli sayfa: DNS yok; IP lookup'a yonlendir, IPv4 ise PTR + DNSBL ---
  if (ipLiteral) {
    showNotice("This page is addressed by IP — no DNS records to resolve. IP lookup is pre-filled.");
    if (ipInput) ipInput.value = ipLiteral;
    try {
      if (isIPv4(ipLiteral)) {
        await Promise.all([
          fetchPTRRecord(ipLiteral).then((r) => displayRecords(r, "PTR", countElements.ptr)),
          checkBlacklist([{ data: ipLiteral }])
        ]);
      } else setPill("na");
    } catch (_) { setPill("unknown"); }
    hideLoader();
    return;
  }

  // --- Skeleton ---
  document.querySelectorAll(".dns-records .record-content").forEach((c) => {
    c.innerHTML = '<div class="skel"></div><div class="skel"></div>';
  });

  // --- DNS sorgulari ---
  const isTrDomain = /\.tr$/.test(hostname);
  async function fetchDNSRecords(recordType) {
    const tn = TYPE_NUM[recordType];
    let ans = answersOf(await doh(hostname, recordType), tn);
    // .tr alan adlarinda bozuk DNSSEC sik: once dogrulamasiz (cd), sonra ECS'siz tekrar dene
    if (!ans.length && isTrDomain) {
      ans = answersOf(await doh(hostname, recordType, { cd: "true", do: "true" }), tn);
      if (!ans.length) {
        ans = answersOf(await doh(hostname, recordType, { cd: "true", do: "true", edns_client_subnet: "0.0.0.0/0" }), tn);
      }
    }
    return ans;
  }

  async function fetchWWWRecord() {
    const wwwHostname = `www.${hostname}`;
    let ans = answersOf(await doh(wwwHostname, "CNAME"), TYPE_NUM.CNAME);
    if (!ans.length) ans = answersOf(await doh(wwwHostname, "A"), TYPE_NUM.A);
    return ans;
  }

  async function fetchPTRRecord(ip) {
    if (!isIPv4(ip)) return [];
    const arpa = ip.split(".").reverse().join(".") + ".in-addr.arpa";
    return answersOf(await doh(arpa, "PTR"), TYPE_NUM.PTR);
  }

  function displayRecords(records, type, countElement) {
    records = Array.isArray(records) ? records : [];
    const contentElement = document.querySelector(`#${type.toLowerCase()}-records .record-content`);
    if (countElement) {
      countElement.textContent = records.length;
      countElement.classList.toggle("zero", records.length === 0);
    }
    if (!contentElement) return;
    contentElement.textContent = ""; // bos kalirsa CSS "$ no records" gosterir
    records.forEach((record) => {
      let data = String(record?.data ?? "");
      if (type === "MX") {
        const [priority, ...rest] = data.split(" ");
        if (rest.length) data = `${rest.join(" ")} (${priority})`;
      }
      if (type === "TXT" && data.length >= 2 && data.startsWith('"') && data.endsWith('"')) {
        data = data.slice(1, -1).split('" "').join(""); // cok parcali TXT
      }
      const item = el("div", "record-item");
      item.dataset.copy = data;
      item.title = "Click to copy";
      item.appendChild(el("div", "record-data", data));
      if (Number.isFinite(record?.TTL)) item.appendChild(el("div", "ttl", `TTL ${record.TTL}s`));
      contentElement.appendChild(item);
    });
  }

  document.querySelector(".dns-records")?.addEventListener("click", (e) => {
    const item = e.target.closest(".record-item");
    if (item?.dataset.copy) copyText(item.dataset.copy, null);
  });

  // --- DNS blacklists (depends on A records) ---
  // Spamhaus/SURBL gibi listeler public resolver'lari (dns.google dahil) reddediyor; buradakiler
  // dns.google uzerinden cevap veren listeler (test noktasi 127.0.0.2 ile dogrulandi, 2026-11).
  // Her saglayici once 127.0.0.2 test noktasiyla dogrulanir; cevap vermeyen "unavailable" sayilir,
  // boylece NXDOMAIN hicbir zaman yanlislikla "temiz" yorumlanmaz.

  async function dnsblState(bl, ip) {
    const js = await doh(ip.split(".").reverse().join(".") + "." + bl.zone, "A");
    if (!js) return "unknown";
    if (js.Status === 3) return "clean"; // NXDOMAIN
    if (js.Status !== 0) return "unknown";
    const vals = answersOf(js, TYPE_NUM.A).map((a) => String(a.data));
    if (!vals.length) return "clean";
    return vals.some(bl.listed || listedCode()) ? "listed" : "unknown"; // 127.255.255.x = query refused
  }

  async function checkBlacklist(aRecords) {
    try {
      const ips = [...new Set(aRecords.map((r) => String(r?.data ?? "")).filter(isIPv4))].slice(0, MAX_BL_IPS);
      if (!ips.length) { setPill("na"); return; }
      setPill("unknown", "…", "Checking " + DNSBLS.length + " blacklists…");
      const per = await Promise.all(DNSBLS.map(async (bl) => {
        const [sentinel, ...states] = await Promise.all(
          ["127.0.0.2", ...ips].map((ip) => dnsblState(bl, ip).catch(() => "unknown")));
        if (sentinel !== "listed") return { bl, state: "unavailable" };
        const hits = ips.filter((_, i) => states[i] === "listed");
        return { bl, hits, state: hits.length ? "listed" : states.includes("unknown") ? "unknown" : "clean" };
      }));
      const checked = per.filter((r) => r.state !== "unavailable");
      const listed = per.filter((r) => r.state === "listed");
      const lines = per.map((r) =>
        `${r.state === "listed" ? "✗" : r.state === "clean" ? "✓" : "?"} ${r.bl.name}: ` +
        (r.state === "listed" ? "listed (" + r.hits.join(", ") + ")" : r.state));
      const title = `Checked ${ips.join(", ")}\n` + lines.join("\n");
      if (!checked.length) { setPill("unknown", null, title); return; }
      if (listed.length) { setPill("listed", `Listed ${listed.length}/${checked.length}`, title); return; }
      const allClean = checked.every((r) => r.state === "clean");
      setPill(allClean ? "clean" : "unknown", allClean ? `Clean ${checked.length}/${checked.length}` : null, title);
    } catch (e) { console.error("Blacklist check error", e); setPill("unknown"); }
  }

  // --- Load: fire independent queries in parallel, render each as it lands ---
  try {
    const safe = (p, type, countEl) => p.catch(() => []).then((r) => { displayRecords(r, type, countEl); return r; });
    const aP = safe(fetchDNSRecords("A"), "A", countElements.a);
    const others = [
      safe(fetchWWWRecord(), "WWW", countElements.www),
      safe(fetchDNSRecords("NS"), "NS", countElements.ns),
      safe(fetchDNSRecords("MX"), "MX", countElements.mx),
      safe(fetchDNSRecords("TXT"), "TXT", countElements.txt)
    ];

    const aRecords = await aP;
    dnsAIps = aRecords.map((r) => String(r.data));
    paintSipHint();
    // A-dependent queries in parallel
    await Promise.allSettled([
      (async () => {
        if (!aRecords.length) { displayRecords([], "PTR", countElements.ptr); return; }
        const ptrResults = await Promise.all(aRecords.map((r) => fetchPTRRecord(String(r.data)).catch(() => [])));
        displayRecords(ptrResults.flat(), "PTR", countElements.ptr);
      })(),
      checkBlacklist(aRecords),
      ...others
    ]);
  } catch (error) {
    showError(error?.message || String(error));
    setPill("unknown");
  } finally {
    hideLoader();
  }
});
