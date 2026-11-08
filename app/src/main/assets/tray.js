/*
 * Cleangram Stories row: runs on instagram.com's Home page when it's loaded inside the small,
 * sandboxed frame Cleangram puts into the inbox (cleangram.js), and leaves only the Stories tray
 * visible. Finds the tray by what it is (a sideways-scrolling row of profile pictures), not by
 * Instagram's class names. Tapping a story asks the inbox page to open it (the frame can't
 * navigate anything itself). Also used by the app's fallback row, outside any frame.
 * No globals, nothing of Instagram's replaced.
 */
(() => {
  "use strict";
  if (location.pathname !== "/") return;
  const framed = window.top !== window;
  // In the app's main view only inside the inbox's frame; the fallback row runs it unframed.
  if (!framed && "__CG_STANDALONE__" !== "1") return;
  const root = document.documentElement;
  if (root.hasAttribute("data-cg-tray")) return;
  root.setAttribute("data-cg-tray", "1");

  function addStyle() {
    if (document.getElementById("cg-tray-style")) return;
    const parent = document.head || document.documentElement;
    if (!parent) return;
    const s = document.createElement("style");
    s.id = "cg-tray-style";
    s.textContent =
      ".cg-tray-off{display:none!important}" +
      "html,body{overflow:hidden!important;overscroll-behavior:none!important;margin:0!important}" +
      ".cg-tray-path{margin-top:0!important;padding-top:0!important;min-height:0!important;height:auto!important;" +
      "position:static!important;transform:none!important}" +
      "::-webkit-scrollbar{display:none}";
    parent.appendChild(s);
  }

  function findTray() {
    let best = null;
    for (const img of document.querySelectorAll("img[alt]")) {
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
  let lastHeight = 0;
  function isolate() {
    addStyle();
    if (!document.body) return;
    const found = findTray();
    if (!found) return;
    tray = found;
    for (let el = tray; el && el !== document.body; el = el.parentElement) {
      el.classList.add("cg-tray-path");
      const p = el.parentElement;
      if (!p) break;
      for (const sib of p.children) {
        if (sib !== el && sib.tagName !== "SCRIPT" && sib.tagName !== "STYLE") sib.classList.add("cg-tray-off");
      }
    }
    tray.classList.remove("cg-tray-path");
    scrollTo(0, 0);
    const h = Math.ceil(tray.getBoundingClientRect().bottom + 4);
    root.setAttribute("data-cg-tray-height", String(h));
    if (framed && h !== lastHeight && h > 30) {
      lastHeight = h;
      parent.postMessage({ cg: "tray-height", h }, location.origin);
    }
  }

  // In the inbox's frame, a tap on a story is handed to the inbox page to open full screen.
  if (framed) {
    document.addEventListener("click", (e) => {
      if (!tray || !tray.contains(e.target)) return;
      let item = e.target;
      while (item && item.parentElement && item.parentElement !== tray
             && item.parentElement.querySelectorAll("img[alt]").length < 2) item = item.parentElement;
      const img = item && item.querySelector ? item.querySelector("img[alt]") : null;
      const alt = img ? img.getAttribute("alt") || "" : "";
      const m = alt.match(/^(.+?)['’]s profile picture$/i);
      const label = item ? (item.innerText || "").trim().split("\n").pop() : "";
      e.preventDefault();
      e.stopPropagation();
      if (/^your story$/i.test(label)) parent.postMessage({ cg: "my-story" }, location.origin);
      else if (m) parent.postMessage({ cg: "story", user: m[1] }, location.origin);
    }, true);
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
  addEventListener("resize", schedule);
  schedule();
})();
