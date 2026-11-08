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

  function sweep() {
    const html = document.documentElement;
    const r = route(location.pathname);
    if (html.getAttribute("data-cg-route") !== r) html.setAttribute("data-cg-route", r);
    addStyle();
    if (!document.body) return;

    // Instagram's own tab bar (the app has its own): the smallest block holding its links to
    // Explore or Reels together with Home or Messages, wherever it sits.
    for (const a of document.querySelectorAll('a[href="/explore/"], a[href="/reels/"]')) {
      let el = a.parentElement;
      for (let i = 0; el && el !== document.body && i < 10; i++, el = el.parentElement) {
        if (el.querySelector('a[href="/"], a[href^="/direct/"]')) {
          if (el.getBoundingClientRect().height < 120) el.classList.add("cg-hide");
          break;
        }
      }
    }

    // Banners and notes Cleangram leaves out, found by their words: "open the app",
    // "Instagram Lite", "You're all caught up", suggestions.
    // Only what's new since the last sweep (or everything, on a new page): cheap even in a
    // long DM thread.
    const roots = pageChanged(r) ? [document.body] : takeAdded();
    const inThread = location.pathname.startsWith("/direct/t/");
    for (const root of roots) {
      if (!root.isConnected) continue;
      const list = root.querySelectorAll ? root.querySelectorAll("span, h1, h2, h3, div, a, button") : [];
      for (const el of [root, ...list]) {
        if (!(el instanceof Element) || el.childElementCount > 2) continue;
        const t = (el.textContent || "").trim();
        if (t.length === 0 || t.length > 60 || !UNWANTED.test(t)) continue;
        hideAround(el, inThread);
      }
    }
  }

  let lastRoute = "";
  let lastPath = "";
  function pageChanged(r) {
    const changed = r !== lastRoute || location.pathname !== lastPath;
    lastRoute = r;
    lastPath = location.pathname;
    if (changed) added.length = 0;
    return changed;
  }

  const added = [];
  function takeAdded() {
    const out = added.splice(0, added.length);
    return out.length > 400 ? [document.body] : out;
  }

  const UNWANTED = /^(open app|open the app|use the app|get the app|open instagram|switch to the app|you'?re all caught up|you'?ve seen all new posts.*|suggested for you|suggested posts|suggested reels|discover people)$|instagram lite/i;

  /**
   * Hide the banner or block a phrase belongs to: its fixed/sticky/dialog box, or a few levels up.
   * In a chat, only floating banners: never anything in the conversation itself.
   */
  function hideAround(el, floatingOnly) {
    let target = null;
    for (let x = el, i = 0; x && x !== document.body && i < 10; i++, x = x.parentElement) {
      const role = x.getAttribute("role");
      const pos = getComputedStyle(x).position;
      if (pos === "fixed" || pos === "sticky" || role === "dialog" || role === "banner" || x.tagName === "SECTION") {
        target = x;
        break;
      }
    }
    if (!target && floatingOnly) return;
    if (!target) {
      target = el;
      for (let i = 0; i < 3 && target.parentElement && target.parentElement !== document.body; i++) {
        target = target.parentElement;
        if (target.getBoundingClientRect().height > 260) { target = target.firstElementChild || target; break; }
      }
    }
    if (target && target !== document.body && target !== document.documentElement) target.classList.add("cg-hide");
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

  new MutationObserver((records) => {
    for (const rec of records) for (const n of rec.addedNodes) if (n.nodeType === 1) added.push(n);
    schedule();
  }).observe(document.documentElement, { childList: true, subtree: true });
  addEventListener("popstate", schedule);
  addEventListener("DOMContentLoaded", schedule);
  schedule();
})();
