// --- Utility: update security indicator icon & color ---
function setIndicator(element, isOk, okIconClass = "fa-check", badIconClass = "fa-times") {
    if (!element) return;
    element.classList.remove("ok", "bad");
    element.classList.add(isOk ? "ok" : "bad");
    element.innerHTML = `<i class="fa ${isOk ? okIconClass : badIconClass}"></i>`;
}

document.addEventListener("DOMContentLoaded", async () => {
    // Global error handler to show errors in the popup UI
    window.addEventListener("error", function (e) {
        let loader = document.querySelector(".loader");
        if (loader) loader.style.display = "none";
        let container = document.querySelector(".container");
        if (container) {
            let errBox = document.createElement("div");
            errBox.style.background = "#c00";
            errBox.style.color = "#fff";
            errBox.style.padding = "12px";
            errBox.style.margin = "12px";
            errBox.style.borderRadius = "8px";
            errBox.style.fontWeight = "bold";
            errBox.textContent = "Extension Error: " + e.message;
            container.prepend(errBox);
        }
        console.error("Extension Error:", e);
    });
    // --- Elements ---
    const loader = document.querySelector(".loader");
    const currentSite = document.querySelector(".current-site");
    const mainTabs = document.querySelectorAll(".main-tabs > .tab[data-tab]");
    const dnsSection = document.getElementById("dns-section");
    const ipSection = document.getElementById("ip-section");
    const themeToggle = document.getElementById("theme-toggle");
    const favoritesSection = document.getElementById("favorites-section");
    const settingsSection = document.getElementById("settings-section");
    const favoritesList = document.getElementById("favorites-list");
    const favToggle = document.getElementById("fav-toggle");
    const blacklistIndicator = document.getElementById("blacklist-indicator");
    const themeSelect = document.getElementById("theme-select");

    // DNS inner tabs
    // Select DNS type tabs globally to ensure they are always found
    let dnsTabs = document.querySelectorAll(".inner-tabs .tab");
    let recordBoxes = document.querySelectorAll(".dns-records .record-box");
    if (!dnsTabs.length || !recordBoxes.length) {
        console.error("DNS tabs or record boxes not found in DOM.");
    }
    const countElements = {
        a: document.getElementById("a-count"),
        www: document.getElementById("www-count"),
        ns: document.getElementById("ns-count"),
        mx: document.getElementById("mx-count"),
        txt: document.getElementById("txt-count"),
        ptr: document.getElementById("ptr-count")
    };

    // IP Lookup elements
    const ipInput = document.getElementById("ip-input");
    const lookupBtn = document.getElementById("lookup-btn");
    const ipResult = document.getElementById("ip-result");

    // --- Theme management ---
    function applyTheme(mode) {
        const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
        let isDark = false;
        if (mode === "dark") isDark = true;
        else if (mode === "light") isDark = false;
        else isDark = prefersDark;

        document.body.classList.toggle("dark-theme", isDark);
        if (themeToggle) themeToggle.textContent = isDark ? "🌙" : "☀️";
        localStorage.setItem("dnsRecordsTheme", mode);
        if (themeSelect) themeSelect.value = mode;
    }
    const savedTheme = localStorage.getItem("dnsRecordsTheme") || "system";
    applyTheme(savedTheme);

    if (themeToggle) {
        themeToggle.addEventListener("click", () => {
            const current = localStorage.getItem("dnsRecordsTheme") || "system";
            const next = current === "light" ? "dark" : "light";
            applyTheme(next);
        });
    }

    if (themeSelect) {
        themeSelect.addEventListener("change", () => applyTheme(themeSelect.value));
    }

    // --- Main tab switching (DNS/IP/Favorites/Settings) ---
    const allSections = {
        dns: dnsSection,
        ip: ipSection,
        favorites: favoritesSection,
        settings: settingsSection
    };

    mainTabs.forEach(tab => {
        tab.addEventListener("click", e => {
            if (e.currentTarget !== tab) return;
            mainTabs.forEach(t => t.classList.remove("active"));
            tab.classList.add("active");
            const target = tab.dataset.tab;
            Object.keys(allSections).forEach(key => {
                const section = allSections[key];
                if (section) section.classList.toggle("active", key === target);
            });
        });
    });

    // --- DNS inner tab switching ---
    dnsTabs.forEach(tab => {
        tab.addEventListener("click", (e) => {
            // Only switch if the click is directly on the tab, not a child
            if (e.target !== tab) return;
            dnsTabs.forEach(t => t.classList.remove("active"));
            recordBoxes.forEach(box => box.classList.remove("active"));
            tab.classList.add("active");
            const tabName = tab.getAttribute("data-tab");
            const boxId = tabName + "-records";
            const recordBox = document.getElementById(boxId);
            if (recordBox) recordBox.classList.add("active");
            else console.error("Record box not found for tab:", tabName);
        });
    });

    // --- DNSRATOR DNS logic ---
    try {
        // Chrome API fallback for testing
        if (typeof chrome === "undefined" || !chrome.tabs) {
            window.chrome = {
                tabs: {
                    query: (options) => Promise.resolve([{ url: "https://example.com" }])
                }
            };
        }
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.url) {
            throw new Error("Could not get active tab or tab URL.");
        }
        const url = new URL(tab.url);
        let hostname = url.hostname;
        const displayHostname = hostname;
        if (hostname.startsWith("www.")) {
            hostname = hostname.substring(4);
        }
        if (currentSite) {
            currentSite.textContent = displayHostname;
            // Initialize favorite star state and handler
            if (favToggle) {
                function refreshFavIcon() {
                    const fav = JSON.parse(localStorage.getItem("dnsFavorites") || "[]");
                    const isFav = fav.includes(displayHostname);
                    favToggle.classList.toggle("active", isFav);
                    const icon = favToggle.querySelector("i");
                    if (icon) icon.className = isFav ? "fa-solid fa-star" : "fa-regular fa-star";
                    favToggle.title = isFav ? "Remove from favorites" : "Add to favorites";
                }
                refreshFavIcon();
                favToggle.addEventListener("click", () => {
                    let fav = JSON.parse(localStorage.getItem("dnsFavorites") || "[]");
                    if (fav.includes(displayHostname)) {
                        fav = fav.filter(d => d !== displayHostname);
                    } else {
                        fav.push(displayHostname);
                    }
                    localStorage.setItem("dnsFavorites", JSON.stringify(fav));
                    refreshFavIcon();
                    loadFavorites();
                });
            }
        } else {
            console.error("currentSite element not found.");
        }

        async function fetchDNSRecords(recordType) {
            try {
                let response = await fetch(`https://dns.google/resolve?name=${hostname}&type=${recordType}`);
                let data = await response.json();
                const trDomains = [".tr", ".com.tr", ".net.tr", ".org.tr", ".web.tr", ".gen.tr", ".av.tr"];
                const isTrDomain = trDomains.some((ext) => hostname.toLowerCase().endsWith(ext));
                if ((!data.Answer || data.Answer.length === 0) && isTrDomain) {
                    response = await fetch(`https://dns.google/resolve?name=${hostname}&type=${recordType}&cd=true&do=true`);
                    data = await response.json();
                    if (!data.Answer || data.Answer.length === 0) {
                        response = await fetch(
                            `https://dns.google/resolve?name=${hostname}&type=${recordType}&cd=true&do=true&edns_client_subnet=0.0.0.0/0`
                        );
                        data = await response.json();
                    }
                }
                return data.Answer || [];
            } catch (error) {
                console.error(`Error fetching ${recordType} records:`, error);
                return [];
            }
        }

        async function fetchWWWRecord() {
            try {
                const wwwHostname = `www.${hostname}`;
                let response = await fetch(`https://dns.google/resolve?name=${wwwHostname}&type=CNAME`);
                let data = await response.json();
                if (!data.Answer || data.Answer.length === 0) {
                    response = await fetch(`https://dns.google/resolve?name=${wwwHostname}&type=A`);
                    data = await response.json();
                }
                return data.Answer || [];
            } catch (error) {
                console.error("Error fetching WWW record:", error);
                return [];
            }
        }

        async function fetchPTRRecord(ip) {
            try {
                const arpa = ip.split('.').reverse().join('.') + '.in-addr.arpa';
                const response = await fetch(`https://dns.google/resolve?name=${arpa}&type=PTR`);
                const data = await response.json();
                return data.Answer || [];
            } catch (error) {
                console.error("Error fetching PTR record:", error);
                return [];
            }
        }

        function displayRecords(records, type, countElement) {
            let contentElement;
            switch (type) {
                case "A":
                    contentElement = document.querySelector("#a-records .record-content");
                    if (countElement) countElement.textContent = records.length;
                    break;
                case "WWW":
                    contentElement = document.querySelector("#www-records .record-content");
                    if (countElement) countElement.textContent = records.length;
                    break;
                case "NS":
                    contentElement = document.querySelector("#ns-records .record-content");
                    if (countElement) countElement.textContent = records.length;
                    break;
                case "MX":
                    contentElement = document.querySelector("#mx-records .record-content");
                    if (countElement) countElement.textContent = records.length;
                    break;
                case "TXT":
                    contentElement = document.querySelector("#txt-records .record-content");
                    if (countElement) countElement.textContent = records.length;
                    break;
                case "PTR":
                    contentElement = document.querySelector("#ptr-records .record-content");
                    if (countElement) countElement.textContent = records.length;
                    break;
            }
    
            // (Interactive DNS record logic removed as per user request)
            if (!contentElement || !records.length) {
                if (contentElement) contentElement.innerHTML = "";
                return;
            }
            contentElement.innerHTML = records
                .map((record) => {
                    let data = record.data;
                    if (type === "MX") {
                        const [priority, server] = data.split(" ");
                        data = `${server} (${priority})`;
                    }
                    if (type === "TXT") {
                        if (data.startsWith('"') && data.endsWith('"')) {
                            data = data.substring(1, data.length - 1);
                        }
                    }
                    return `<div class="record-item">
                              <div class="record-data">${data}</div>
                              <div class="ttl">TTL: ${record.TTL}s</div>
                            </div>`;
                })
                .join("");
        }

        // Fetch and display DNS records
        const aRecords = await fetchDNSRecords("A");
        displayRecords(aRecords, "A", countElements.a);

        // --- Update security indicator (Blacklist only) ---
        // Blacklist (Spamhaus)
        try {
            const ips = (aRecords || [])
                .map(r => r.data)
                .filter(ip => /^\d+\.\d+\.\d+\.\d+$/.test(ip));
            let listed = false;
            for (const ip of ips) {
                const rev = ip.split('.').reverse().join('.') + '.zen.spamhaus.org';
                const resp = await fetch(`https://dns.google/resolve?name=${rev}&type=A`);
                const js = await resp.json();
                if (js.Answer && js.Answer.length > 0) {
                    listed = true;
                    break;
                }
            }
            setIndicator(blacklistIndicator, !listed, "fa-shield-check", "fa-triangle-exclamation");
            blacklistIndicator.title = listed ? "Listed in spam/blacklist" : "Not listed in spam/blacklist";
        } catch (e) {
            console.error("Blacklist check error", e);
        }

        if (aRecords && aRecords.length > 0) {
            const ptrPromises = aRecords.map(record => fetchPTRRecord(record.data));
            const ptrResults = await Promise.all(ptrPromises);
            const ptrRecords = ptrResults.flat();
            displayRecords(ptrRecords, "PTR", countElements.ptr);
        }

        const wwwRecords = await fetchWWWRecord();
        displayRecords(wwwRecords, "WWW", countElements.www);

        const nsRecords = await fetchDNSRecords("NS");
        displayRecords(nsRecords, "NS", countElements.ns);

        const mxRecords = await fetchDNSRecords("MX");
        displayRecords(mxRecords, "MX", countElements.mx);

        const txtRecords = await fetchDNSRecords("TXT");
        displayRecords(txtRecords, "TXT", countElements.txt);

    } catch (error) {
        console.error("Error:", error);
    } finally {
        loader.style.display = "none";
    }

    // --- IP Scan logic (adapted from ip-scan/popup.js) ---
    function renderIpResult(info) {
        if (!info) {
            ipResult.textContent = "IP information not found.";
            return;
        }
        let hostnameRow = "";
        if (info.hostname) {
            hostnameRow = `<div class="ipscan-hostname"><strong>Hostname:</strong> ${info.hostname}</div>`;
        }
        // Flag fallback logic
        const cc = (info.countryCode || info.country || "unknown")
            .slice(0, 2)
            .toLowerCase();
        const flagHosts = [
            `https://flagcdn.com/24x18/${cc}.png`,
            `https://cdn.jsdelivr.net/npm/svg-country-flags@1.2.10/png100px/${cc}.png`,
            `https://cdnjs.cloudflare.com/ajax/libs/flag-icon-css/4.1.7/flags/4x3/${cc}.svg`,
            `https://flagicons.lipis.dev/flags/4x3/${cc}.svg`,
            `https://hatscripts.github.io/circle-flags/flags/${cc}.svg`,
            `https://raw.githubusercontent.com/lipis/flag-icons/main/flags/4x3/${cc}.svg`,
            `https://raw.githubusercontent.com/hampusborgos/country-flags/main/png/${cc}.png`,
            `https://raw.githubusercontent.com/madebybowtie/FlagKit/master/Assets/SVG/${cc}.svg`,
            `https://flagcdn.com/48x36/${cc}.png`,
            `https://flagcdn.com/16x12/${cc}.png`,
            // +5 additional flag CDNs
            `https://flagsapi.com/${cc.toUpperCase()}/flat/24.png`,
            `https://www.countryflags.io/${cc}/flat/24.png`,
            `https://countryflagsapi.com/png/${cc}`,
            `https://www.geonames.org/flags/x/${cc}.gif`,
            `https://flagpedia.net/data/flags/normal/${cc}.png`
        ];
        ipResult.innerHTML = `
            <div class="ipscan-card">
                <div class="ipscan-card-header">
                    <img class="ipscan-flag" src="${flagHosts[0]}" alt="">
                    <div class="ipscan-ip">${info.ip}</div>
                </div>
                ${hostnameRow}
                <div class="ipscan-info">
                    <span><strong>Country:</strong> ${info.country}</span>
                    <span><strong>Region:</strong> ${info.region}</span>
                    <span><strong>City:</strong> ${info.city}</span>
                    <span><strong>Org:</strong> ${info.org}</span>
                </div>
                <div class="ipscan-source">Source: ${new URL(info.source).hostname}</div>
            </div>
        `;
        // Fallback logic for flag image
        const img = ipResult.querySelector(".ipscan-flag");
        let hostIdx = 0;
        img.onerror = () => {
            hostIdx++;
            if (hostIdx < flagHosts.length) {
                img.src = flagHosts[hostIdx];
            } else {
                img.onerror = null; // stop trying
            }
        };
    }

    if (lookupBtn && ipInput && ipResult) {
        lookupBtn.addEventListener("click", () => {
            const ip = ipInput.value.trim();
            if (!ip) return;
            lookupBtn.disabled = true;
            ipResult.textContent = "Loading...";
            chrome.runtime.sendMessage({ type: "lookup", ip }, info => {
                renderIpResult(info);
                lookupBtn.disabled = false;
            });
        });

        ipInput.addEventListener("keydown", e => {
            if (e.key === "Enter") lookupBtn.click();
        });
    } else {
        console.error("IP lookup elements not found in DOM.");
    }

// --- SSL Query logic ---
/* Domain Info feature removed */

    // --- Favorites handling ---
    function loadFavorites() {
        if (!favoritesList) return;
        const fav = JSON.parse(localStorage.getItem("dnsFavorites") || "[]");
        favoritesList.innerHTML = "";
        if (fav.length === 0) {
            favoritesList.textContent = "No favorites yet";
            return;
        }
        fav.forEach(domain => {
            const item = document.createElement("div");
            item.className = "favorite-item";
            item.innerHTML = `<span>${domain}</span><button class="remove-fav" data-domain="${domain}" title="Remove"><i class="fa fa-trash"></i></button>`;
            favoritesList.appendChild(item);
        });
    }

    if (favoritesList) {
        favoritesList.addEventListener("click", e => {
            const btn = e.target.closest(".remove-fav");
            if (!btn) return;
            const domain = btn.dataset.domain;
            let fav = JSON.parse(localStorage.getItem("dnsFavorites") || "[]");
            fav = fav.filter(d => d !== domain);
            localStorage.setItem("dnsFavorites", JSON.stringify(fav));
            loadFavorites();
        });
    }

    loadFavorites();

// Normalize SSL API responses to {name, issued, expires}
function normalizeSSLResponse(data, url) {
    // ssllabs
    if (url.includes("ssllabs.com") && data && data.endpoints && data.endpoints[0] && data.endpoints[0].details && data.endpoints[0].details.cert) {
        const cert = data.endpoints[0].details.cert;
        return {
            name: cert.subject ? cert.subject.CN || cert.subject.commonName : "",
            issued: cert.notBefore ? new Date(cert.notBefore).toISOString().slice(0, 10) : "",
            expires: cert.notAfter ? new Date(cert.notAfter).toISOString().slice(0, 10) : ""
        };
    }
    // hackertarget
    if (url.includes("hackertarget.com") && typeof data === "object" && data.issuer_commonname) {
        return {
            name: data.common_name || "",
            issued: data.valid_from || "",
            expires: data.valid_to || ""
        };
    }
    // certspotter
    if (url.includes("certspotter.com") && Array.isArray(data) && data.length > 0) {
        const cert = data[0];
        return {
            name: cert.cert && cert.cert.subject && cert.cert.subject.common_name || "",
            issued: cert.cert && cert.cert.not_before ? cert.cert.not_before.split("T")[0] : "",
            expires: cert.cert && cert.cert.not_after ? cert.cert.not_after.split("T")[0] : ""
        };
    }
    // x509labs
    if (url.includes("x509labs.com") && data && data.certificate) {
        return {
            name: data.certificate.subject_common_name || "",
            issued: data.certificate.valid_from || "",
            expires: data.certificate.valid_to || ""
        };
    }
    // sslchecker
    if (url.includes("sslchecker") && data && data.issuer) {
        return {
            name: data.common_name || "",
            issued: data.valid_from || "",
            expires: data.valid_to || ""
        };
    }
    // fallback: try to extract from common fields if present
    if (typeof data === "object" && data) {
        if (data.common_name || data.subject_common_name) {
            return {
                name: data.common_name || data.subject_common_name || "",
                issued: data.valid_from || data.not_before || "",
                expires: data.valid_to || data.not_after || ""
            };
        }
        // Some APIs may return a nested cert object
        if (data.cert && (data.cert.common_name || data.cert.subject_common_name)) {
            return {
                name: data.cert.common_name || data.cert.subject_common_name || "",
                issued: data.cert.valid_from || data.cert.not_before || "",
                expires: data.cert.valid_to || data.cert.not_after || ""
            };
        }
    }
    return null;
}
});