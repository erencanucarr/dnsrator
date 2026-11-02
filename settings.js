// settings.js — theme + ServerIP + mnemonic + endpoint management (MV3)
// IPv4 (octets <= 255) or IPv6 — the real server IP is often IPv6 (Cloudflare, Google...)
const isIp = (ip) => {
  if (!ip) return false;
  if (ip.includes(":")) return /^[0-9a-f:.]+$/i.test(ip) && ip.length <= 45;
  const parts = ip.split(".");
  return parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p) && +p <= 255);
};
const CORNERS = ["top-right", "top-left", "bottom-right", "bottom-left"];
const qs = (sel) => document.querySelector(sel);
const send = (msg) => new Promise((res) => {
  try {
    chrome.runtime.sendMessage(msg, (r) => res(r));
  } catch (_) { res(null); }
});

/* ---------- Endpoint satirlari (mevcut davranis) ---------- */
function createEndpointRow(value = "") {
  const row = document.createElement("div");
  row.className = "endpoint-row";
  const input = document.createElement("input");
  input.type = "text";
  input.value = value;
  input.placeholder = "https://.../{ip}";
  input.setAttribute("aria-label", "IP API endpoint");
  const delBtn = document.createElement("button");
  delBtn.textContent = "✕";
  delBtn.title = "Remove";
  delBtn.type = "button";
  delBtn.className = "btn icon";
  delBtn.addEventListener("click", () => row.remove());
  row.appendChild(input);
  row.appendChild(delBtn);
  return row;
}

function renderEndpoints(list) {
  const container = qs("#endpoints-container");
  container.innerHTML = "";
  (list?.length ? list : [""]).forEach((ep) => container.appendChild(createEndpointRow(ep)));
}

/* ---------- Mnemonic satirlari (ServerIP options.js portu) ---------- */
function createMnemRow(ip = "", mnem = "", color = "#ff0000") {
  const row = document.createElement("div");
  row.className = "mnem-row";
  row.innerHTML = `
    <input class="mnem-ip" type="text" maxlength="45" placeholder="IP (1.2.3.4 / 2606::1)" value="" aria-label="IP" />
    <input class="mnem-name" type="text" maxlength="4" placeholder="abc" value="" aria-label="Mnemonic" />
    <input class="mnem-color" type="color" value="#ff0000" aria-label="Color" />
    <button class="btn icon mnem-del" type="button" title="Remove">✕</button>`;
  row.querySelector(".mnem-ip").value = ip;
  row.querySelector(".mnem-name").value = mnem;
  row.querySelector(".mnem-color").value = /^#[0-9a-f]{6}$/i.test(color) ? color : "#ff0000";
  row.querySelector(".mnem-del").addEventListener("click", () => row.remove());
  return row;
}

function renderMnemonics(map) {
  const container = qs("#mnem-container");
  container.innerHTML = "";
  const entries = Object.entries(map || {});
  if (!entries.length) {
    for (let i = 0; i < 2; i++) container.appendChild(createMnemRow());
    return;
  }
  entries
    .sort((a, b) => (a[1]?.mnem || "").localeCompare(b[1]?.mnem || ""))
    .forEach(([ip, v]) => container.appendChild(createMnemRow(ip, v?.mnem || "", v?.color || "#ff0000")));
}

function collectMnemonics() {
  const map = {};
  document.querySelectorAll(".mnem-row").forEach((row) => {
    const raw = row.querySelector(".mnem-ip").value.trim();
    // IPv6 addresses arrive lowercase from webRequest
    const ip = raw.includes(":") ? raw.toLowerCase() : raw;
    const mnem = row.querySelector(".mnem-name").value.trim().slice(0, 4);
    const color = row.querySelector(".mnem-color").value;
    if (isIp(ip) && mnem) map[ip] = { mnem, color };
  });
  return map;
}

/* ---------- ServerIP alt kontrollerini kilitle ---------- */
function refreshSipLock() {
  const on = qs("#sip-enabled").checked;
  qs("#sip-sub").classList.toggle("locked", !on);
  ["#sip-badge", "#sip-hover", "#sip-corner", "#sip-reset-pos", "#sip-color"].forEach((s) => {
    const el = qs(s);
    if (el) el.disabled = !on;
  });
}

function collectServerIpSettings() {
  return {
    enabled: qs("#sip-enabled").checked,
    showBadge: qs("#sip-badge").checked,
    showHover: qs("#sip-hover").checked,
    hoverCorner: CORNERS.includes(qs("#sip-corner").value) ? qs("#sip-corner").value : "top-right",
    defaultColor: qs("#sip-color").value
  };
}

function flashStatus(text) {
  const status = qs("#save-status");
  status.textContent = text;
  clearTimeout(flashStatus.t);
  flashStatus.t = setTimeout(() => (status.textContent = ""), 2000);
}

// ServerIP switches apply immediately — users expect "off" to mean off without hunting for Save.
async function applyServerIpSettings() {
  const r = await send({ type: "setServerIpSettings", settings: collectServerIpSettings() });
  flashStatus(r?.ok ? "Applied ✓" : "Could not apply — try Save");
}

/* ---------- Save ---------- */
async function saveSettings() {
  const btn = qs("#save-btn");
  btn.disabled = true;
  try {
    const theme = qs("#theme-select").value;
    const endpoints = Array.from(document.querySelectorAll(".endpoint-row input"))
      .map((i) => i.value.trim())
      .filter(Boolean);
    const settings = collectServerIpSettings();
    const mnemonics = collectMnemonics();
    const results = [
      await send({ type: "setTheme", theme }),
      await send({ type: "setEndpoints", endpoints }),
      await send({ type: "setServerIpSettings", settings, mnemonics })
    ];
    try { localStorage.setItem("dnsRecordsTheme", theme); } catch (_) {}
    if (results.some((r) => !r?.ok)) throw new Error("background did not respond");
    // reflect what was actually stored (invalid endpoints/mnemonic rows are dropped)
    renderEndpoints(await send({ type: "getEndpoints" }) || endpoints);
    renderMnemonics(mnemonics);
    flashStatus("Saved ✓");
  } catch (e) {
    flashStatus("Save failed: " + (e?.message || e));
  } finally {
    btn.disabled = false;
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  // Theme
  const theme = await send({ type: "getTheme" });
  const t = theme || localStorage.getItem("dnsRecordsTheme") || "dark";
  qs("#theme-select").value = ["dark", "light", "system"].includes(t) ? t : "dark";
  document.documentElement.setAttribute("data-theme", qs("#theme-select").value);
  qs("#theme-select").addEventListener("change", (e) =>
    document.documentElement.setAttribute("data-theme", e.target.value));

  // Endpoints
  const list = await send({ type: "getEndpoints" });
  renderEndpoints(Array.isArray(list) ? list : []);
  qs("#add-endpoint").addEventListener("click", () =>
    qs("#endpoints-container").appendChild(createEndpointRow()));

  // ServerIP
  const state = await send({ type: "getServerIpSettings" });
  const s = state?.settings || {};
  qs("#sip-enabled").checked = s.enabled !== false;
  qs("#sip-badge").checked = s.showBadge !== false;
  qs("#sip-hover").checked = s.showHover !== false;
  qs("#sip-corner").value = CORNERS.includes(s.hoverCorner) ? s.hoverCorner : "top-right";
  qs("#sip-color").value = /^#[0-9a-f]{6}$/i.test(s.defaultColor) ? s.defaultColor : "#ff9b33";
  qs("#sip-color-out").textContent = qs("#sip-color").value;
  renderMnemonics(state?.mnemonics || {});
  refreshSipLock();

  qs("#sip-enabled").addEventListener("change", refreshSipLock);
  ["#sip-enabled", "#sip-badge", "#sip-hover", "#sip-corner", "#sip-color"].forEach((sel) =>
    qs(sel).addEventListener("change", applyServerIpSettings));
  qs("#sip-color").addEventListener("input", (e) => {
    qs("#sip-color-out").textContent = e.target.value;
  });
  // a corner choice only shows if there is no dragged position, so picking one resets it
  const resetPos = async () => {
    try { await chrome.storage.local.remove("serverIpHoverPos"); } catch (_) {}
  };
  qs("#sip-corner").addEventListener("change", resetPos);
  qs("#sip-reset-pos").addEventListener("click", async () => {
    await resetPos();
    flashStatus("Position reset ✓");
  });
  qs("#add-mnem").addEventListener("click", () =>
    qs("#mnem-container").appendChild(createMnemRow()));
  qs("#save-btn").addEventListener("click", saveSettings);
});
