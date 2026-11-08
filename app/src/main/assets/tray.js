/*
 * Cleangram Stories row: runs on instagram.com's Home page inside the small view above the
 * inbox, and leaves only the Stories tray visible: everything around it (the header, the feed,
 * Instagram's bottom bar) is hidden. Finds the tray by what it is (a sideways-scrolling row of
 * profile pictures near the top), not by Instagram's class names, which change.
 * No globals, nothing of Instagram's replaced.
 */
(() => {
  "use strict";
  if (document.documentElement.hasAttribute("data-cg-tray")) return;
  document.documentElement.setAttribute("data-cg-tray", "1");

  function addStyle() {
    if (document.getElementById("cg-tray-style")) return;
    const parent = document.head || document.documentElement;
    if (!parent) return;
    const s = document.createElement("style");
    s.id = "cg-tray-style";
    s.textContent =
      ".cg-tray-off{display:none!important}" +
      "html,body{overflow:hidden!important;overscroll-behavior:none!important}" +
      ".cg-tray-path{margin-top:0!important;padding-top:0!important;min-height:0!important;height:auto!important;" +
      "position:static!important;transform:none!important}" +
      "::-webkit-scrollbar{display:none}";
    parent.appendChild(s);
  }

  function findTray() {
    const pics = document.querySelectorAll('img[alt]');
    let best = null;
    for (const img of pics) {
      if (!/profile picture/i.test(img.getAttribute("alt") || "")) continue;
      for (let el = img.parentElement, i = 0; el && el !== document.body && i < 12; el = el.parentElement, i++) {
        const ox = getComputedStyle(el).overflowX;
        if ((ox === "auto" || ox === "scroll") && el.scrollWidth > el.clientWidth + 8) {
          const top = el.getBoundingClientRect().top + scrollY;
          if (!best || top < best.top) best = { el, top };
          break;
        }
      }
    }
    return best && best.el;
  }

  let tray = null;
  function isolate() {
    addStyle();
    if (!document.body) return;
    const found = findTray();
    if (!found) return;
    tray = found;
    // Keep the tray and its ancestors; hide every sibling along the way.
    for (let el = tray; el && el !== document.body; el = el.parentElement) {
      el.classList.add("cg-tray-path");
      const p = el.parentElement;
      if (!p) break;
      for (const sib of p.children) {
        if (sib !== el && !sib.classList.contains("cg-tray-off") && sib.tagName !== "SCRIPT" && sib.tagName !== "STYLE") {
          sib.classList.add("cg-tray-off");
        }
      }
    }
    tray.classList.remove("cg-tray-path");
    scrollTo(0, 0);
    const r = tray.getBoundingClientRect();
    document.documentElement.setAttribute("data-cg-tray-height", String(Math.ceil(r.bottom + 6)));
  }

  let queued = false;
  function schedule() {
    if (queued) return;
    queued = true;
    setTimeout(() => requestAnimationFrame(() => {
      queued = false;
      try { isolate(); } catch (e) { /* never break the page */ }
    }), 120);
  }
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  addEventListener("DOMContentLoaded", schedule);
  schedule();
})();
