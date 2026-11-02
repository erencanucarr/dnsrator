/* DNSRator hover overlay — MV3 port of ServerIP hover-box.js
 * Uses Shadow DOM (immune to site CSS) and the top layer (popover) when available,
 * so page transforms / z-index wars can't misplace or cover it.
 * Behavior from chrome.storage.local -> serverIp:
 * { enabled, showHover, hoverCorner, defaultColor } + mnemonics { ip: {mnem,color} }
 * Position: serverIpHoverPos -> { h: "left"|"right", x, v: "top"|"bottom", y } (edge-anchored)
 */
(() => {
  // Re-injected into a tab where this instance is still alive (same extension context):
  // reuse it instead of stacking a second copy with its own listeners.
  if (window.__dnsratorHover) {
    window.__dnsratorHover.render();
    return;
  }

  const HOST_ID = "dnsrator-serverip-host";
  const POS_KEY = "serverIpHoverPos";
  const DISMISS_KEY = "dnsrator-hover-dismissed";
  const MARGIN = 8;
  const DEFAULTS = {
    enabled: true,
    showBadge: true,
    showHover: true,
    hoverCorner: "top-right",
    defaultColor: "#ff9b33"
  };
  const CORNERS = ["top-right", "top-left", "bottom-right", "bottom-left"];

  let hostEl = null;
  let shadow = null;
  let boxEl = null;
  let dragState = null;
  let currentIp = null;
  let copyFlashTimer = null;
  let settings = { ...DEFAULTS };
  let savedPos = null;
  let dismissed = false;
  let renderSeq = 0;

  // Anything left in the DOM with our id belongs to an older (orphaned) copy,
  // e.g. from before an extension update/reload — its context is dead, so remove it.
  document.getElementById(HOST_ID)?.remove();

  function alive() {
    try { return !!chrome.runtime?.id; } catch (_) { return false; }
  }

  function isIp(ip) {
    if (typeof ip !== "string" || !ip) return false;
    if (ip.includes(":")) return /^[0-9a-f:.]+$/i.test(ip) && ip.length <= 45;
    const parts = ip.split(".");
    return parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p) && +p <= 255);
  }

  function isDismissed() {
    if (dismissed) return true;
    try { return sessionStorage.getItem(DISMISS_KEY) === "1"; } catch (_) { return false; }
  }

  /* ---------- Position ---------- */
  function cornerPos(corner) {
    const c = CORNERS.includes(corner) ? corner : DEFAULTS.hoverCorner;
    const [v, h] = c.split("-");
    return { h, x: 12, v, y: 12 };
  }

  function normPos(p) {
    if (!p || typeof p !== "object") return null;
    // legacy { top, left }
    if (typeof p.top === "number" && typeof p.left === "number") {
      return { h: "left", x: p.left, v: "top", y: p.top };
    }
    if ((p.h === "left" || p.h === "right") && (p.v === "top" || p.v === "bottom") &&
        Number.isFinite(p.x) && Number.isFinite(p.y)) return p;
    return null;
  }

  function viewport() {
    // clientWidth/Height exclude scrollbars, but in quirks mode they measure <html>, not the viewport
    const de = document.compatMode === "CSS1Compat" ? document.documentElement : null;
    return {
      w: de?.clientWidth || window.innerWidth || 1200,
      h: de?.clientHeight || window.innerHeight || 800
    };
  }

  const clamp = (n, lo, hi) => Math.min(Math.max(lo, n), Math.max(lo, hi));

  function setHostEdges(left, top, right, bottom) {
    const st = hostEl.style;
    st.setProperty("left", left == null ? "auto" : left + "px", "important");
    st.setProperty("top", top == null ? "auto" : top + "px", "important");
    st.setProperty("right", right == null ? "auto" : right + "px", "important");
    st.setProperty("bottom", bottom == null ? "auto" : bottom + "px", "important");
  }

  function applyPos() {
    if (!hostEl || dragState) return;
    const p = normPos(savedPos) || cornerPos(settings.hoverCorner);
    const vp = viewport();
    const w = boxEl.offsetWidth || 140;
    const h = boxEl.offsetHeight || 32;
    const x = clamp(p.x, MARGIN, vp.w - w - MARGIN);
    const y = clamp(p.y, MARGIN, vp.h - h - MARGIN);
    setHostEdges(
      p.h === "left" ? x : null,
      p.v === "top" ? y : null,
      p.h === "right" ? x : null,
      p.v === "bottom" ? y : null
    );
  }

  // Anchor to the nearest edges so the box keeps its corner when the window is resized.
  function posFromRect(r) {
    const vp = viewport();
    const right = r.left + r.width / 2 > vp.w / 2;
    const bottom = r.top + r.height / 2 > vp.h / 2;
    return {
      h: right ? "right" : "left",
      x: Math.round(right ? vp.w - r.right : r.left),
      v: bottom ? "bottom" : "top",
      y: Math.round(bottom ? vp.h - r.bottom : r.top)
    };
  }

  async function savePos() {
    try {
      savedPos = posFromRect(boxEl.getBoundingClientRect());
      applyPos();
      if (alive()) await chrome.storage.local.set({ [POS_KEY]: savedPos });
    } catch (_) { /* ignore */ }
  }

  /* ---------- DOM ---------- */
  function ensureHost() {
    if (hostEl) {
      if (!hostEl.isConnected) document.documentElement.appendChild(hostEl);
      return;
    }
    hostEl = document.createElement("div");
    hostEl.id = HOST_ID;
    const st = hostEl.style;
    st.cssText = "all:initial";
    [
      ["position", "fixed"], ["z-index", "2147483647"], ["display", "block"],
      ["margin", "0"], ["padding", "0"], ["border", "0"], ["width", "auto"], ["height", "auto"],
      ["overflow", "visible"], ["background", "transparent"], ["color", "inherit"],
      ["inset", "auto"], ["pointer-events", "auto"]
    ].forEach(([k, v]) => st.setProperty(k, v, "important"));
    shadow = hostEl.attachShadow({ mode: "closed" });
    shadow.innerHTML = `
      <style>
        .box{
          display:flex;align-items:center;gap:8px;
          padding:6px 6px 6px 10px;border-radius:999px;
          font:600 12px/1.2 -apple-system,"Segoe UI",Roboto,Arial,sans-serif;
          color:#fff;background:#ff9b33;border:1px solid rgba(0,0,0,.25);
          box-shadow:0 4px 14px rgba(0,0,0,.25);
          cursor:grab;user-select:none;-webkit-user-select:none;white-space:nowrap;
          touch-action:none;
        }
        .box.dragging{cursor:grabbing;}
        .ip{font-variant-numeric:tabular-nums;letter-spacing:.02em;text-shadow:0 1px 1px rgba(0,0,0,.25);}
        .mnem{background:rgba(255,255,255,.25);border-radius:999px;padding:2px 8px;font-size:11px;}
        .mnem[hidden]{display:none;}
        .x{border:0;background:rgba(0,0,0,.25);color:#fff;width:20px;height:20px;padding:0;border-radius:50%;cursor:pointer;font:12px/1 Arial,sans-serif;}
        .x:hover{background:rgba(0,0,0,.45);}
      </style>
      <div class="box" title="Double-click to copy · Drag to move">
        <span class="mnem" hidden></span>
        <span class="ip"></span>
        <button class="x" type="button" title="Hide in this tab">×</button>
      </div>`;
    boxEl = shadow.querySelector(".box");

    boxEl.querySelector(".x").addEventListener("click", (e) => {
      e.stopPropagation();
      dismissed = true;
      try { sessionStorage.setItem(DISMISS_KEY, "1"); } catch (_) {}
      destroy();
    });
    boxEl.querySelector(".x").addEventListener("pointerdown", (e) => e.stopPropagation());

    boxEl.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      const r = hostEl.getBoundingClientRect();
      dragState = { sx: e.clientX, sy: e.clientY, left: r.left, top: r.top, moved: false };
      try { boxEl.setPointerCapture(e.pointerId); } catch (_) {}
    });
    boxEl.addEventListener("pointermove", (e) => {
      if (!dragState) return;
      const dx = e.clientX - dragState.sx;
      const dy = e.clientY - dragState.sy;
      if (!dragState.moved && Math.abs(dx) + Math.abs(dy) <= 3) return;
      dragState.moved = true;
      boxEl.classList.add("dragging");
      const vp = viewport();
      const left = clamp(dragState.left + dx, MARGIN, vp.w - boxEl.offsetWidth - MARGIN);
      const top = clamp(dragState.top + dy, MARGIN, vp.h - boxEl.offsetHeight - MARGIN);
      setHostEdges(left, top, null, null);
    });
    const endDrag = () => {
      if (!dragState) return;
      const moved = dragState.moved;
      dragState = null;
      boxEl.classList.remove("dragging");
      if (moved) savePos();
    };
    boxEl.addEventListener("pointerup", endDrag);
    boxEl.addEventListener("pointercancel", endDrag);
    boxEl.addEventListener("lostpointercapture", endDrag);

    // double-click: copy IP to clipboard + flash feedback
    boxEl.addEventListener("dblclick", (e) => {
      e.preventDefault();
      if (!currentIp) return;
      copyToClipboard(currentIp, () => {
        const ipEl = boxEl.querySelector(".ip");
        ipEl.textContent = "✓ copied";
        clearTimeout(copyFlashTimer);
        copyFlashTimer = setTimeout(() => { ipEl.textContent = currentIp || ""; }, 1200);
      });
    });

    document.documentElement.appendChild(hostEl);
  }

  // Top layer: above every page stacking context and unaffected by transforms/filters on <html>.
  function promote() {
    try {
      if (typeof hostEl.showPopover !== "function") return;
      if (!hostEl.hasAttribute("popover")) hostEl.setAttribute("popover", "manual");
      if (!hostEl.matches(":popover-open")) hostEl.showPopover();
    } catch (_) { /* fall back to plain fixed positioning */ }
  }

  function destroy() {
    dragState = null;
    currentIp = null;
    clearTimeout(copyFlashTimer);
    try { hostEl?.remove(); } catch (_) {}
    hostEl = shadow = boxEl = null;
  }

  function copyToClipboard(text, done) {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => legacyCopy(text, done));
    } else legacyCopy(text, done);
  }
  function legacyCopy(text, done) {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.cssText = "position:fixed;opacity:0;";
      (document.body || document.documentElement).appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
      done?.();
    } catch (_) { /* ignore */ }
  }

  /* ---------- Render ---------- */
  async function render() {
    if (!alive()) { teardown(); return; }
    const seq = ++renderSeq;
    let stored;
    try {
      stored = await chrome.storage.local.get(["serverIp", "mnemonics", "serverIpByHost", POS_KEY]);
    } catch (_) { teardown(); return; }
    if (seq !== renderSeq) return; // a newer render superseded this one

    settings = { ...DEFAULTS, ...(stored.serverIp || {}) };
    savedPos = stored[POS_KEY] || null;
    if (!settings.enabled || !settings.showHover || isDismissed()) { destroy(); return; }

    const entry = (stored.serverIpByHost || {})[location.hostname];
    const ip = typeof entry === "string" ? entry : entry?.ip;
    if (!isIp(ip)) { destroy(); return; }

    ensureHost();
    currentIp = ip;
    const m = (stored.mnemonics || {})[ip];
    boxEl.style.background = m?.color || settings.defaultColor || DEFAULTS.defaultColor;
    clearTimeout(copyFlashTimer);
    boxEl.querySelector(".ip").textContent = ip;
    const mnemEl = boxEl.querySelector(".mnem");
    mnemEl.hidden = !m?.mnem;
    mnemEl.textContent = m?.mnem || "";
    promote();
    applyPos();
  }

  function hostIp(map) {
    const e = (map || {})[location.hostname];
    return typeof e === "string" ? e : e?.ip || null;
  }

  function onStorageChanged(changes, area) {
    if (area !== "local") return;
    if (!alive()) { teardown(); return; }
    const byHost = changes.serverIpByHost;
    const relevant =
      changes.serverIp || changes.mnemonics ||
      (changes[POS_KEY] && !dragState) ||
      (byHost && hostIp(byHost.newValue) !== hostIp(byHost.oldValue));
    if (relevant) render();
  }

  function onResize() { applyPos(); }
  function onVisible() {
    if (document.visibilityState !== "visible") return;
    if (!alive()) teardown();
  }
  function onPageShow(e) { if (e.persisted) render(); }

  // Extension was reloaded/updated/disabled: this copy can no longer talk to it.
  function teardown() {
    destroy();
    try { chrome.storage?.onChanged?.removeListener(onStorageChanged); } catch (_) {}
    window.removeEventListener("resize", onResize);
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("pageshow", onPageShow);
    if (window.__dnsratorHover?.render === render) delete window.__dnsratorHover;
  }

  // Only plain HTML documents (skip XML/SVG/PDF viewers etc.)
  if (!(document.documentElement instanceof HTMLElement)) return;

  window.__dnsratorHover = { render };
  try { chrome.storage.onChanged.addListener(onStorageChanged); } catch (_) {}
  window.addEventListener("resize", onResize);
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("pageshow", onPageShow);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", render, { once: true });
  } else {
    render();
  }
})();
