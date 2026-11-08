/*
 * Cleangram: runs at the start of every instagram.com page, before Instagram's own code.
 *
 * Hides what Cleangram leaves out (the feed, Reels, Explore, "open the app" nags, Instagram's
 * own bottom bar, which the app replaces) and nothing else. It only adds a stylesheet and
 * watches the page to hide things as they appear: no globals, nothing of Instagram's wrapped
 * or replaced, no requests of its own.
 *
 * The page's route is kept on <html data-cg-route="...">, so the stylesheet can tell pages
 * apart; the app also sets it the moment the address changes.
 */
(() => {
  "use strict";
  if (document.documentElement.hasAttribute("data-cg")) return;
  document.documentElement.setAttribute("data-cg", "1");

  const CSS = "__CLEANGRAM_CSS__";

  const RESERVED = new Set(["accounts", "direct", "explore", "reels", "reel", "p", "tv", "stories",
    "about", "legal", "developer", "challenge", "emails", "web", "api", "graphql", "oauth", "privacy",
    "session", "create", "notifications", "your_activity", "settings", "ar", "topics", "locations"]);

  function route(path) {
    const s = path.split("/").filter(Boolean);
    if (s.length === 0) return "home";
    switch (s[0]) {
      case "direct": return "inbox";
      case "explore": return s[1] === "search" ? "search" : "explore";
      case "reels": return "reels";
      case "reel": case "p": case "tv": return "post";
      case "stories": return "stories";
      case "notifications": return "activity";
      case "accounts": return s[1] === "activity" ? "activity" : "accounts";
    }
    return RESERVED.has(s[0]) ? "other" : "profile";
  }

  function addStyle() {
    if (document.getElementById("cg-style")) return;
    const parent = document.head || document.documentElement;
    if (!parent) return;
    const style = document.createElement("style");
    style.id = "cg-style";
    style.textContent = CSS;
    parent.appendChild(style);
  }

  const NAG = /^(open app|open the app|use the app|get the app|open instagram|switch to the app|not now)$/i;

  function sweep() {
    const html = document.documentElement;
    const r = route(location.pathname);
    if (html.getAttribute("data-cg-route") !== r) html.setAttribute("data-cg-route", r);
    addStyle();
    if (!document.body) return;

    // Instagram's own bottom bar: a fixed strip along the bottom with its Home/Explore/Reels
    // links. The app has its own bar instead.
    for (const a of document.querySelectorAll('a[href="/reels/"], a[href="/explore/"]')) {
      let el = a.parentElement;
      for (let i = 0; el && i < 8; i++, el = el.parentElement) {
        const cs = getComputedStyle(el);
        if (cs.position === "fixed" || cs.position === "sticky") {
          const rect = el.getBoundingClientRect();
          if (rect.bottom >= innerHeight - 4 && rect.height < 120) el.classList.add("cg-hide");
          break;
        }
      }
    }

    // "Open the app" banners and buttons.
    for (const el of document.querySelectorAll('a, button, div[role="button"]')) {
      const t = (el.textContent || "").trim();
      if (t.length > 0 && t.length < 24 && NAG.test(t) && /app|instagram/i.test(t)) {
        const box = el.closest('div[role="dialog"], div[role="banner"], section') || el;
        box.classList.add("cg-hide");
      }
    }

    // "Suggested for you" and similar recommendation blocks, wherever they appear.
    for (const el of document.querySelectorAll("span, h2, h3")) {
      if (el.childElementCount > 0) continue;
      const t = (el.textContent || "").trim();
      if (t === "Suggested for you" || t === "Suggested posts" || t === "Suggested reels"
          || t === "More posts from" || t === "Discover people") {
        const box = el.closest("section, article, div[role='presentation']") || el.parentElement;
        if (box && box !== document.body) box.classList.add("cg-hide");
      }
    }
  }

  // At most five sweeps a second, however busy the page: long DM threads change constantly.
  let queued = false;
  let last = 0;
  function schedule() {
    if (queued) return;
    queued = true;
    const wait = Math.max(0, 200 - (Date.now() - last));
    setTimeout(() => requestAnimationFrame(() => {
      queued = false;
      last = Date.now();
      try { sweep(); } catch (e) { /* never break the page */ }
    }), wait);
  }

  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  addEventListener("popstate", schedule);
  addEventListener("DOMContentLoaded", schedule);
  schedule();
})();
