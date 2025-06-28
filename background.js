const IPV4_REGEX = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const IPV6_REGEX =
  /^(?:[a-fA-F0-9]{1,4}:){1,7}[a-fA-F0-9]{1,4}$/; 

// “{ip}” placeholder will be replaced at runtime.
const DEFAULT_ENDPOINTS = [
  "https://ip-api.com/json/{ip}",
  "https://ipwho.is/{ip}",
  "https://ipinfo.io/{ip}/json",
  "https://ipapi.co/{ip}/json",
  "https://freeipapi.com/api/json/{ip}",
  "https://ip.nf/{ip}.json",
  "https://api.ip.sb/geoip/{ip}",
  "https://extreme-ip-lookup.com/json/{ip}",
  "https://ipapi.com/ip_api.php?ip={ip}",
  "https://ip.seeip.org/geoip/{ip}",
  // +5 additional APIs
  "https://geo.ipify.org/api/v2/country,city?apiKey=at_demo&ipAddress={ip}",
  "https://ipgeolocation.abstractapi.com/v1/?api_key=demo&ip_address={ip}",
  "https://ipgeolocation.io/ip-location/{ip}?apiKey=free",
  "https://ipstack.com/ipstack_api.php?ip={ip}&access_key=free",
  "https://ipapi.es/{ip}"
];

/* ---------- Storage Helpers ---------- */
async function getEndpointList() {
  const { endpoints } = await chrome.storage.local.get("endpoints");
  if (Array.isArray(endpoints) && endpoints.length) return endpoints;
  // first-run: persist defaults
  await chrome.storage.local.set({ endpoints: DEFAULT_ENDPOINTS });
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
      raw.IP ||
      raw.data?.ip ||
      "Unknown",
    // ISO-2 country code for flag
    countryCode:
      raw.countryCode ||
      raw.country_code ||
      raw.data?.country_code ||
      (typeof raw.country === "string" ? raw.country.slice(0, 2) : null),
    country:
      raw.country ||
      raw.country_name ||
      raw.countryCode ||
      raw.country_code ||
      raw.country_name ||
      raw.data?.country ||
      "Unknown",
    region:
      raw.region ||
      raw.regionName ||
      raw.region_name ||
      raw.state ||
      "Unknown",
    city: raw.city || raw.data?.city || "Unknown",
    org:
      raw.org ||
      raw.isp ||
      raw.connection?.organization ||
      raw.connection?.isp ||
      raw.connection?.org ||
      raw.connection?.organisation ||
      raw.asn ||
      raw.autonomous_system_organization ||
      "Unknown",
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
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) continue;
      const data = await res.json();
      if (data && typeof data === "object") {
        if (data.status && String(data.status).toLowerCase() === "fail")
          continue;

        const normalized = await normalizeResponse(data, url);
        if (normalized.country && normalized.country !== "Unknown") {
          // add hostname via reverse DNS
          normalized.hostname = await getHostname(ip);
          await chrome.storage.session.set({ [ip]: normalized });
          return normalized;
        }
      }
    } catch (_) {    }
  }
  return null;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "lookup") {
    lookupIp(msg.ip).then(sendResponse);
    return true; // keep channel open
  }
  if (msg?.type === "getEndpoints") {
    getEndpointList().then(list => sendResponse(list));
    return true;
  }
  if (msg?.type === "setEndpoints" && Array.isArray(msg.endpoints)) {
    chrome.storage.local.set({ endpoints: msg.endpoints }).then(() =>
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
  if (msg?.type === "setTheme" && (msg.theme === "dark" || msg.theme === "light")) {
    chrome.storage.local.set({ theme: msg.theme }).then(() =>
      sendResponse({ ok: true })
    );
    return true;
  }
  return false;
});
/**
 * Multi-API WHOIS background script.
 * Listens for domain info requests and queries several public WHOIS APIs in parallel.
 * Responds with the first successful result, or an error if all fail.
 */
chrome.runtime.onMessage.addListener(async (msg, sender, sendResponse) => {
    if (msg.type === "whois") {
        const host = msg.host;
        const apis = [
            `https://api.whois.vu/?q=${host}`,
            `https://api.hackertarget.com/whois/?q=${host}`,
            `https://jsonwhoisapi.com/api/v1/whois?identifier=${host}`,
            // Additional public/free endpoints (scraper proxies, fallback)
            `https://rproxy.glumy.cc/https://who.is/whois/${host}`,
            `https://rdap.org/domain/${host}`,
            `https://rdap.verisign.com/com/v1/domain/${host}`,
            `https://rdap.markmonitor.com/rdap/domain/${host}`,
            `https://rdap.godaddy.com/v1/domain/${host}`
        ];
        let responded = false;
        let completed = 0;
        for (const url of apis) {
            fetch(url, { cache: "no-store" })
                .then(async res => {
                    let data;
                    try {
                        data = await res.json();
                    } catch {
                        data = await res.text();
                    }
                    // Try to normalize and respond if not already done
                    if (!responded) {
                        const info = normalizeWhoisResponse(data, url);
                        if (info && (info.registered || info.expiry || info.registrar)) {
                            responded = true;
                            sendResponse({ info, url });
                        }
                    }
                })
                .catch(() => {
                    // Ignore errors, just count as completed
                })
                .finally(() => {
                    completed++;
                    if (completed === apis.length && !responded) {
                        responded = true;
                        sendResponse({ info: null, url: null });
                    }
                });
        }
        // Required for async sendResponse
        return true;
    }
});

// Normalization function for WHOIS APIs
function normalizeWhoisResponse(data, url) {
    // whois.vu
    if (url.includes("whois.vu") && data && typeof data === "object") {
        return {
            registered: data.created || data.creation_date || data.registered || "",
            expiry: data.expiry || data.expiration_date || data.expires || "",
            registrar: data.registrar || data.sponsor || ""
        };
    }
    // hackertarget
    if (url.includes("hackertarget.com") && typeof data === "string") {
        // Parse text for known fields
        const regMatch = data.match(/(Creation Date|Registered On|created):\s*([^\r\n]+)/i);
        const expMatch = data.match(/(Expiry Date|Expiration Date|expires):\s*([^\r\n]+)/i);
        const regisMatch = data.match(/Registrar:\s*([^\r\n]+)/i);
        return {
            registered: regMatch ? regMatch[2].trim() : "",
            expiry: expMatch ? expMatch[2].trim() : "",
            registrar: regisMatch ? regisMatch[1].trim() : ""
        };
    }
    // jsonwhoisapi
    if (url.includes("jsonwhoisapi.com") && data && typeof data === "object") {
        return {
            registered: data.created || data.creation_date || "",
            expiry: data.expires_at || data.expiry || data.expiration_date || "",
            registrar: data.registrar_name || data.registrar || ""
        };
    }
    // who.is (scraped HTML, fallback)
    if (url.includes("who.is") && typeof data === "string") {
        // Try to extract fields from HTML
        const regMatch = data.match(/Registered On<\/div>\s*<div class="col-md-8">([^<]+)</i);
        const expMatch = data.match(/Expires On<\/div>\s*<div class="col-md-8">([^<]+)</i);
        const regisMatch = data.match(/Registrar<\/div>\s*<div class="col-md-8">([^<]+)</i);
        return {
            registered: regMatch ? regMatch[1].trim() : "",
            expiry: expMatch ? expMatch[1].trim() : "",
            registrar: regisMatch ? regisMatch[1].trim() : ""
        };
    }
    // RDAP (JSON)
    if ((url.includes("rdap") || url.includes("verisign") || url.includes("markmonitor") || url.includes("godaddy")) && data && typeof data === "object") {
        return {
            registered: data.events && Array.isArray(data.events) ? (data.events.find(e => e.eventAction === "registration")?.eventDate || "") : "",
            expiry: data.events && Array.isArray(data.events) ? (data.events.find(e => e.eventAction === "expiration")?.eventDate || "") : "",
            registrar: data.registrar ? (data.registrar.name || data.registrar) : (data.entities && Array.isArray(data.entities) ? (data.entities.find(e => e.roles && e.roles.includes("registrar"))?.vcardArray?.[1]?.find(v => v[0] === "fn")?.[3] || "") : "")
        };
    }
    // fallback: try to extract from common fields if present
    if (typeof data === "object" && data) {
        return {
            registered: data.created || data.creation_date || data.registered || "",
            expiry: data.expiry || data.expiration_date || data.expires || "",
            registrar: data.registrar || data.sponsor || data.registrar_name || ""
        };
    }
    return null;
}