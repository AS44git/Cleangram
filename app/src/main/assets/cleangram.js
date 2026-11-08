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
  const IS_TOP = window.top === window;

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
    if (IS_TOP) inbox();

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

  // --- the inbox: laid out like the app ------------------------------------------------------
  //
  // Stories go under the header and above Search, inside the page so they scroll away with the
  // messages. They come from Instagram's own Home page in a small sandboxed frame (it can run
  // its scripts and see its own cookies, nothing else: it can't navigate this page or open
  // anything), with everything but the Stories tray hidden (tray.js). The frame lives on
  // <body> so the page re-rendering never reloads it; a spacer in the page holds its place and
  // the frame follows the spacer as the list scrolls.

  const onList = () => /^\/direct\/inbox\/?$/.test(location.pathname);
  let spacer = null, box = null, frame = null, trayH = 0, trayState = "none", following = false;

  function inbox() {
    const list = onList();
    // Back arrow: not on the message list (the app has its own tabs); it stays in a chat.
    for (const el of document.querySelectorAll(".cg-back")) if (!list) el.classList.remove("cg-back");
    if (!list) {
      if (box) box.style.display = "none";
      return;
    }
    const back = document.querySelector('svg[aria-label="Back"]');
    if (back) (back.closest('a, button, [role="button"]') || back).classList.add("cg-back");

    const compose = document.querySelector('svg[aria-label="New message"]');
    addHeart(compose);
    if (trayState !== "failed") placeTray(compose);
  }

  /** A heart (your activity) beside "New message", as in the app's header. */
  function addHeart(compose) {
    if (!compose || document.querySelector(".cg-heart")) return;
    const btn = compose.closest('a, button, [role="button"]') || compose;
    const a = document.createElement("a");
    a.className = "cg-heart";
    a.href = "/accounts/activity/";
    a.setAttribute("aria-label", "Activity");
    a.innerHTML = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linejoin="round"><path d="M12 20.5s-7.5-4.6-9.2-9.3C1.6 7.6 3.9 4 7.5 4c2 0 3.5 1.1 4.5 ' +
      '2.6C13 5.1 14.5 4 16.5 4c3.6 0 5.9 3.6 4.7 7.2-1.7 4.7-9.2 9.3-9.2 9.3z"/></svg>';
    btn.parentElement.insertBefore(a, btn);
  }

  function placeTray(compose) {
    const search = document.querySelector('input[placeholder^="Search"]');
    if (!search) return;
    // The block holding Search, as a sibling of the header's block: stories go just before it.
    let block = search;
    if (compose) {
      while (block.parentElement && !block.parentElement.contains(compose)) block = block.parentElement;
    } else {
      for (let i = 0; i < 3 && block.parentElement; i++) block = block.parentElement;
    }
    if (!block.parentElement) return;
    if (!spacer) {
      spacer = document.createElement("div");
      spacer.id = "cg-tray-spacer";
    }
    if (spacer.nextElementSibling !== block || spacer.parentElement !== block.parentElement) {
      block.parentElement.insertBefore(spacer, block);
    }
    spacer.style.height = trayH + "px";
    if (!box) makeFrame();
    box.style.display = trayH ? "block" : "none";
    if (!following) { following = true; requestAnimationFrame(follow); }
  }

  function makeFrame() {
    box = document.createElement("div");
    box.id = "cg-tray-box";
    frame = document.createElement("iframe");
    frame.id = "cg-tray-frame";
    frame.setAttribute("sandbox", "allow-scripts allow-same-origin");
    frame.setAttribute("scrolling", "no");
    frame.setAttribute("title", "Stories");
    frame.src = "/";
    box.appendChild(frame);
    document.body.appendChild(box);
    trayState = "loading";
    document.documentElement.setAttribute("data-cg-tray", "loading");
    // No word from the frame in 15 s: Instagram won't be framed here; the app takes over.
    setTimeout(() => {
      if (trayState !== "ok") {
        trayState = "failed";
        document.documentElement.setAttribute("data-cg-tray", "failed");
        if (box) box.remove();
        box = frame = null;
        if (spacer) spacer.remove();
      }
    }, 15000);
  }

  /** Keep the frame over its spacer, clipped below the header if the header stays put. */
  function follow() {
    if (!box || box.style.display === "none" || !spacer || !spacer.isConnected || !onList()) {
      following = false;
      if (box && (!onList() || !spacer || !spacer.isConnected)) box.style.display = "none";
      return;
    }
    const r = spacer.getBoundingClientRect();
    let clip = 0;
    const compose = document.querySelector('svg[aria-label="New message"]');
    for (let el = compose, i = 0; el && el !== document.body && i < 10; i++, el = el.parentElement) {
      const pos = getComputedStyle(el).position;
      if (pos === "sticky" || pos === "fixed") { clip = Math.max(0, el.getBoundingClientRect().bottom); break; }
    }
    box.style.top = clip + "px";
    box.style.height = Math.max(0, innerHeight - clip) + "px";
    frame.style.transform = "translateY(" + Math.round(r.top - clip) + "px)";
    requestAnimationFrame(follow);
  }

  if (IS_TOP) {
    addEventListener("message", (e) => {
      if (e.origin !== location.origin || !e.data || typeof e.data !== "object" || !e.data.cg) return;
      const d = e.data;
      if (d.cg === "tray-height" && typeof d.h === "number") {
        trayH = Math.min(240, Math.max(0, Math.round(d.h)));
        trayState = "ok";
        document.documentElement.setAttribute("data-cg-tray", "ok");
        if (frame) frame.style.height = trayH + "px";
        if (spacer) spacer.style.height = trayH + "px";
        if (box && onList()) box.style.display = "block";
        if (!following && box) { following = true; requestAnimationFrame(follow); }
      } else if (d.cg === "story" && typeof d.user === "string" && /^[A-Za-z0-9._]{1,30}$/.test(d.user)) {
        location.assign("/stories/" + d.user + "/");
      } else if (d.cg === "my-story") {
        const me = document.documentElement.getAttribute("data-cg-me");
        if (me) location.assign("/stories/" + me + "/");
      }
    });
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
