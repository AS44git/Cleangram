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

    hideTabBar();

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

  /**
   * Instagram's own tab bar (the app has its own): the smallest block holding its links to
   * Explore or Reels together with Home or Messages, wherever it sits. Also run the moment it's
   * added to the page, before it's ever drawn, so it never flashes up while changing tabs.
   */
  function hideTabBar() {
    for (const a of document.querySelectorAll('a[href="/explore/"], a[href="/reels/"]')) {
      let el = a.parentElement;
      for (let i = 0; el && el !== document.body && i < 10; i++, el = el.parentElement) {
        if (el.querySelector('a[href="/"], a[href^="/direct/"]')) {
          if (!el.classList.contains("cg-hide") && el.getBoundingClientRect().height < 120) el.classList.add("cg-hide");
          break;
        }
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
  // Instagram's website keeps the top of the inbox (header, Search, Notes, "Messages") still and
  // scrolls only the conversation list. The app scrolls it all together, under a header that
  // stays. So here the inbox's column becomes the one thing that scrolls, the header stays put,
  // and Instagram's own list sits pinned below it, moved in step (its own scrolling, loading of
  // more chats and so on carry on exactly as before, it just never sees a finger itself).
  //
  // Stories go above Search, as their own row, built from what Instagram's Home page shows in
  // the app's hidden second view (the app puts it on <html data-cg-stories>).

  const html = document.documentElement;
  const onList = () => /^\/direct\/inbox\/?$/.test(location.pathname);

  function inbox() {
    const list = onList();
    // Back arrow: not on the message list (the app has its own tabs); it stays in a chat.
    for (const el of document.querySelectorAll(".cg-back")) if (!list) el.classList.remove("cg-back");
    if (!list) { flowOff(); flow.failed = false; return; }
    const back = document.querySelector('svg[aria-label="Back"]');
    if (back) (back.closest('a, button, [role="button"]') || back).classList.add("cg-back");

    const compose = document.querySelector('svg[aria-label="New message"]');
    addHeart(compose);
    alignHeart(compose);
    const search = findSearch();
    placeStories(search, compose);
    if (html.hasAttribute("data-cg-noflow")) { flowOff(); html.setAttribute("data-cg-flow", "off"); }
    else flowOn(search, compose);
  }

  function findSearch() {
    return document.querySelector('input[placeholder*="Search" i], input[aria-label*="Search" i], input[type="search"]');
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

  /**
   * The heart and the pencil on one line, the same size, as far apart as in the app, wherever
   * Instagram's header puts the pencil.
   */
  function alignHeart(compose) {
    const heart = document.querySelector(".cg-heart");
    if (!heart || !compose) return;
    const hs = heart.querySelector("svg");
    const cr = compose.getBoundingClientRect();
    if (!hs || !cr.width) return;
    const size = String(Math.round(Math.max(22, Math.min(30, cr.width + 1))));
    if (hs.getAttribute("width") !== size) { hs.setAttribute("width", size); hs.setAttribute("height", size); }
    heart.style.transform = "none";
    const hr = hs.getBoundingClientRect();
    const dx = Math.round(cr.left + cr.width / 2 - 47 - (hr.left + hr.width / 2));
    const dy = Math.round(cr.top + cr.height / 2 - (hr.top + hr.height / 2));
    heart.style.transform = "translate(" + dx + "px," + dy + "px)";
  }

  // --- Stories row ---------------------------------------------------------------------------

  let row = null, rowKey = "";
  const USER = /^[A-Za-z0-9._]{1,30}$/;

  function goodImage(u) {
    try {
      const x = new URL(u);
      return x.protocol === "https:" && (/\.fbcdn\.net$/.test(x.hostname) || /\.cdninstagram\.com$/.test(x.hostname));
    } catch (e) { return false; }
  }

  function storyData() {
    const raw = html.getAttribute("data-cg-stories");
    if (!raw) return [];
    let list;
    try { list = JSON.parse(raw); } catch (e) { return []; }
    if (!Array.isArray(list)) return [];
    return list.filter(s => s && typeof s.user === "string" && USER.test(s.user)).slice(0, 60);
  }

  function buildRow(items) {
    const me = html.getAttribute("data-cg-me");
    const box = row || document.createElement("div");
    box.id = "cg-stories";
    box.setAttribute("role", "list");
    const keepLeft = box.scrollLeft;
    box.textContent = "";
    for (const s of items) {
      const live = s.mine ? !!s.ring : true;
      const a = document.createElement("a");
      a.className = "cg-story" + (s.seen ? " cg-seen" : "") + (s.mine ? " cg-mine" : "") + (live ? "" : " cg-none");
      a.setAttribute("role", "listitem");
      a.href = s.mine ? (live ? "/stories/" + s.user + "/" : (me ? "/" + me + "/" : "/" + s.user + "/")) : "/stories/" + s.user + "/";
      const ring = document.createElement("span");
      ring.className = "cg-ring";
      const img = document.createElement("img");
      img.className = "cg-av";
      img.alt = "";
      img.decoding = "async";
      img.referrerPolicy = "no-referrer";
      if (typeof s.img === "string" && goodImage(s.img)) img.src = s.img;
      img.addEventListener("error", () => { img.removeAttribute("src"); });
      ring.appendChild(img);
      a.appendChild(ring);
      if (s.mine && !live) {
        const plus = document.createElement("span");
        plus.className = "cg-plus";
        a.appendChild(plus);
      }
      const name = document.createElement("span");
      name.className = "cg-name";
      name.textContent = s.mine ? "Your story" : String(s.label || s.user).slice(0, 40);
      a.appendChild(name);
      box.appendChild(a);
    }
    box.scrollLeft = keepLeft;
    return box;
  }

  function placeStories(search, compose) {
    const items = storyData();
    const key = html.getAttribute("data-cg-stories") || "";
    if (!items.length) { if (row) row.remove(); return; }
    if (!row || key !== rowKey) { row = buildRow(items); rowKey = key; }
    // Just above the block holding Search (that block being a sibling of the header's block).
    let block = search;
    if (search && compose) {
      while (block.parentElement && !block.parentElement.contains(compose)) block = block.parentElement;
    } else if (search) {
      for (let i = 0; i < 3 && block.parentElement; i++) block = block.parentElement;
    } else if (compose) {
      // No Search box found: just below the header's block.
      let h = compose;
      for (let i = 0; i < 12 && h.parentElement && h.parentElement !== document.body; i++) {
        const p = h.parentElement;
        if (p.getBoundingClientRect().height > 140) break;
        h = p;
      }
      block = h.nextElementSibling;
      if (block === row) block = row.nextElementSibling;
    }
    if (!block || !block.parentElement) return;
    if (row.nextElementSibling !== block || row.parentElement !== block.parentElement) {
      block.parentElement.insertBefore(row, block);
    }
    // The gap around each picture is the page's own background colour.
    const bg = pageBackground(block.parentElement);
    if (row.style.getPropertyValue("--cg-bg") !== bg) row.style.setProperty("--cg-bg", bg);
  }

  // --- one scroll for the whole inbox --------------------------------------------------------

  const flow = { on: false, P: null, L: null, head: null, spacer: null, holder: null, touched: [],
    S: 0, V: 0, top: 0, stick: 0, lastL: -1, nextTry: 0, sweeps: 0, failed: false };

  /** Inline styles, each remembered so leaving the list puts Instagram's page back exactly. */
  function setStyle(el, props) {
    let rec = flow.touched.find(t => t.el === el);
    if (!rec) { rec = { el, old: {} }; flow.touched.push(rec); }
    for (const k in props) {
      if (!(k in rec.old)) rec.old[k] = [el.style.getPropertyValue(k), el.style.getPropertyPriority(k)];
      if (el.style.getPropertyValue(k) !== String(props[k]) || el.style.getPropertyPriority(k) !== "important") {
        el.style.setProperty(k, String(props[k]), "important");
      }
    }
  }

  function flowOff() {
    if (!flow.on && !flow.touched.length) return;
    if (flow.P) flow.P.removeEventListener("scroll", onColumnScroll);
    if (flow.L) flow.L.removeEventListener("scroll", onListScroll);
    removeEventListener("resize", onResize);
    for (const { el, old } of flow.touched) {
      for (const k in old) {
        const [v, p] = old[k];
        if (v) el.style.setProperty(k, v, p); else el.style.removeProperty(k);
      }
    }
    if (flow.spacer) flow.spacer.remove();
    if (flow.holder) flow.holder.remove();
    Object.assign(flow, { on: false, P: null, L: null, head: null, spacer: null, holder: null, touched: [], lastL: -1 });
  }

  /** The conversation list: the biggest thing below the top of the inbox that scrolls up and down. */
  function findList(anchor) {
    let col = anchor;
    while (col.parentElement && col.parentElement !== document.body && col.getBoundingClientRect().height < innerHeight * 0.6) {
      col = col.parentElement;
    }
    const below = anchor.getBoundingClientRect().bottom - 4;
    // Something that really has more to scroll beats a box that merely could.
    let best = null, bestScore = 0;
    for (const el of col.querySelectorAll("div, ul, section")) {
      const h = el.clientHeight;
      if (h < 120 || el.contains(anchor)) continue;
      const score = h + (el.scrollHeight > h + 20 ? 100000 : 0);
      if (score <= bestScore) continue;
      const oy = getComputedStyle(el).overflowY;
      if (oy !== "auto" && oy !== "scroll") continue;
      if (el.getBoundingClientRect().top < below) continue;
      best = el;
      bestScore = score;
    }
    return best;
  }

  function pageBackground(from) {
    for (let el = from || flow.P; el; el = el.parentElement) {
      const c = getComputedStyle(el).backgroundColor;
      if (c && c !== "transparent" && !/rgba\(.*,\s*0\)$/.test(c)) return c;
    }
    return matchMedia("(prefers-color-scheme: dark)").matches ? "rgb(0, 0, 0)" : "rgb(255, 255, 255)";
  }

  function flowOn(search, compose) {
    if (flow.on) {
      // Still Instagram's same list and column? Then just keep the sizes right.
      if (flow.P.isConnected && flow.L.isConnected && flow.P.contains(flow.L)) {
        if (!flow.spacer.isConnected || flow.spacer.previousSibling !== flow.L) {
          flow.L.parentElement.insertBefore(flow.spacer, flow.L.nextSibling);
        }
        if (++flow.sweeps % 10 === 0) unstick();
        flowMeasure();
        return;
      }
      flowOff();
    }
    const now = Date.now();
    if (now < flow.nextTry || flow.failed) return;
    flow.nextTry = now + 800;
    const anchor = search || compose;
    if (!anchor) { html.setAttribute("data-cg-flow", "no-anchor"); return; }
    const L = findList(anchor);
    if (!L) { html.setAttribute("data-cg-flow", "no-list"); return; }
    let P = L.parentElement;
    while (P && !P.contains(anchor)) P = P.parentElement;
    if (!P || P === document.body || P === html) { html.setAttribute("data-cg-flow", "no-column"); return; }

    flow.on = true;
    flow.P = P;
    flow.L = L;

    // The header (username, heart, New message) stays put: everything else scrolls under it.
    flow.head = null;
    if (compose && P.contains(compose)) {
      let h = compose;
      while (h.parentElement && h.parentElement !== P && !h.parentElement.contains(L)
             && !(search && h.parentElement.contains(search))) h = h.parentElement;
      flow.head = h;
    }

    // The column scrolls; between it and the list nothing holds a fixed height any more.
    // (Both directions: a box clipping sideways would still trap the list's height.)
    for (let el = L.parentElement; el && el !== P; el = el.parentElement) {
      setStyle(el, { height: "auto", "max-height": "none", "min-height": "0", "overflow-x": "visible",
        "overflow-y": "visible", contain: "none" });
      columnChild(el);
    }
    columnChild(L);
    setStyle(P, { "overflow-y": "auto", "overscroll-behavior-y": "contain", "max-height": "none", "min-height": "0" });

    flow.spacer = document.createElement("div");
    flow.spacer.className = "cg-flow-spacer";
    L.parentElement.insertBefore(flow.spacer, L.nextSibling);

    pinHeader();
    unstick();
    flowMeasure();
    P.addEventListener("scroll", onColumnScroll, { passive: true });
    L.addEventListener("scroll", onListScroll, { passive: true });
    addEventListener("resize", onResize, { passive: true });
    if (L.scrollTop > 0) P.scrollTop = L.scrollTop + flow.stick;
    html.setAttribute("data-cg-flow", "on");
    html.setAttribute("data-cg-flowinfo", describe());
    requestAnimationFrame(() => requestAnimationFrame(verify));
  }

  /**
   * Does the column really scroll now? If Instagram's page holds it some way this can't undo,
   * give the page back exactly as it was (its own scrolling) rather than leave a stuck inbox.
   */
  function verify() {
    if (!flow.on) return;
    flowMeasure();
    const P = flow.P;
    const room = P.scrollHeight - P.clientHeight;
    let moves = true;
    if (flow.S > 40) {
      const was = P.scrollTop;
      P.scrollTop = was + 2;
      moves = P.scrollTop !== was;
      P.scrollTop = was;
    }
    if (moves && (flow.S <= 40 || room >= flow.S * 0.9)) return;
    const info = describe() + " room=" + room;
    flowOff();
    flow.failed = true;
    html.setAttribute("data-cg-flow", "failed");
    html.setAttribute("data-cg-flowinfo", info);
  }

  /** For page maps: what the column and list are, and everything between. */
  function describe() {
    const one = (el) => {
      const cs = getComputedStyle(el);
      return el.tagName.toLowerCase() + "[" + [cs.display, cs.flexDirection, cs.flex, "ov=" + cs.overflowX + "/" + cs.overflowY,
        cs.position, "h=" + el.clientHeight, "sh=" + el.scrollHeight, cs.contain].join(",") + "]";
    };
    try {
      const chain = [];
      for (let el = flow.L; el && el !== flow.P.parentElement; el = el.parentElement) chain.push(one(el));
      return "S=" + flow.S + " stick=" + flow.stick + " top=" + flow.top + " head=" + (flow.head ? one(flow.head) : "-") +
        " list>column: " + chain.join(" < ");
    } catch (e) { return "describe failed"; }
  }

  /** In a top-to-bottom flex box, a child keeps its own height instead of being squeezed to fit. */
  function columnChild(el) {
    const p = el.parentElement;
    if (!p) return;
    const cs = getComputedStyle(p);
    if (/flex/.test(cs.display) && /column/.test(cs.flexDirection)) {
      setStyle(el, { "flex-grow": "0", "flex-shrink": "0", "flex-basis": "auto" });
    }
  }

  function pinHeader() {
    const h = flow.head;
    if (!h) return;
    for (let el = h; el && el !== flow.P; el = el.parentElement) {
      if (getComputedStyle(el).position === "fixed") return;   // already stays put
    }
    const bg = pageBackground();
    if (h.parentElement === flow.P) {
      setStyle(h, { position: "sticky", top: "0px", "z-index": "3", "background-color": bg });
    } else {
      // Deeper inside: held in place over the column, with a stand-in keeping its room.
      const r = h.getBoundingClientRect();
      flow.holder = document.createElement("div");
      flow.holder.className = "cg-flow-holder";
      flow.holder.style.height = r.height + "px";
      h.parentElement.insertBefore(flow.holder, h);
      setStyle(h, { position: "fixed", top: r.top + "px", left: r.left + "px", width: r.width + "px",
        "z-index": "3", "background-color": bg });
    }
  }

  /** Nothing in the top part stays stuck while scrolling (Search, Notes, "Messages"): it all moves. */
  function unstick() {
    const P = flow.P, L = flow.L, head = flow.head;
    const walker = document.createTreeWalker(P, NodeFilter.SHOW_ELEMENT, {
      acceptNode: (n) => (n === L || n === head || n === row) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
    });
    let n = 0;
    for (let el = walker.nextNode(); el && n < 3000; el = walker.nextNode(), n++) {
      if (el.contains(L)) continue;
      if (getComputedStyle(el).position === "sticky") setStyle(el, { position: "relative", top: "auto" });
    }
  }

  /** Sizes: the column fills the screen, the list exactly the room under the header. */
  function flowMeasure() {
    if (!flow.on) return;
    const P = flow.P, L = flow.L;
    const pr = P.getBoundingClientRect();
    const ph = Math.max(200, Math.round(innerHeight - Math.max(0, pr.top)));
    setStyle(P, { height: ph + "px" });
    let top = 0;
    if (flow.head) top = Math.max(0, Math.round(flow.head.getBoundingClientRect().bottom - pr.top));
    if (top > ph / 2) top = 0;
    const V = Math.max(120, P.clientHeight - top);
    setStyle(L, { position: "sticky", top: top + "px", height: V + "px", "max-height": "none", "min-height": "0",
      "overflow-y": "hidden", "overscroll-behavior": "auto" });
    const S = Math.max(0, L.scrollHeight - L.clientHeight);
    if (S !== flow.S || !flow.spacer.style.height) { flow.S = S; flow.spacer.style.height = S + "px"; }
    flow.V = V;
    flow.top = top;
    // Where the list's own scrolling begins: once its natural place reaches the header.
    const spacerAt = flow.spacer.getBoundingClientRect().top - pr.top + P.scrollTop;
    flow.stick = Math.max(0, Math.round(spacerAt - V - top));
  }

  function onResize() {
    // A header held in place has to be measured afresh; otherwise sizes simply follow.
    if (flow.holder) { flowOff(); flow.nextTry = 0; schedule(); } else flowMeasure();
  }

  function onColumnScroll() {
    if (!flow.on) return;
    const L = flow.L;
    if (L.scrollHeight - L.clientHeight !== flow.S) flowMeasure();
    const want = Math.max(0, Math.min(flow.S, flow.P.scrollTop - flow.stick));
    if (Math.abs(L.scrollTop - want) >= 1) L.scrollTop = want;
    flow.lastL = L.scrollTop;
  }

  /** Instagram moved its list itself (putting you back where you were): the column follows. */
  function onListScroll() {
    if (!flow.on) return;
    const L = flow.L;
    if (Math.abs(L.scrollTop - flow.lastL) < 2) return;
    flow.lastL = L.scrollTop;
    if (L.scrollHeight - L.clientHeight !== flow.S) flowMeasure();
    if (L.scrollTop > 0) flow.P.scrollTop = L.scrollTop + flow.stick;
  }

  new MutationObserver(() => schedule()).observe(html, { attributes: true, attributeFilter: ["data-cg-stories", "data-cg-noflow"] });

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

  const NAV_LINK = 'a[href="/explore/"], a[href="/reels/"]';
  new MutationObserver((records) => {
    let nav = false;
    for (const rec of records) for (const n of rec.addedNodes) {
      if (n.nodeType !== 1) continue;
      added.push(n);
      if (!nav && (n.matches(NAV_LINK) || n.querySelector(NAV_LINK))) nav = true;
    }
    if (nav && document.body) { try { hideTabBar(); } catch (e) { /* never break the page */ } }
    schedule();
  }).observe(document.documentElement, { childList: true, subtree: true });
  addEventListener("popstate", schedule);
  addEventListener("DOMContentLoaded", schedule);
  schedule();
})();
