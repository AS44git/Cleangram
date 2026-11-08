/*
 * Cleangram page map: an outline of the current page's structure (tags, roles, labels, links,
 * positions, short text) so the hiding can be tuned to Instagram's real layout. On message
 * pages, text is replaced by its length: no message content is ever written down.
 * Evaluated on request only; returns a string.
 */
(() => {
  const privateText = location.pathname.startsWith("/direct");
  const out = [];
  out.push("url " + location.pathname + location.search);
  out.push("viewport " + innerWidth + "x" + innerHeight + " route " + document.documentElement.getAttribute("data-cg-route"));
  const MAX = 6000;
  function attrs(el) {
    const a = [];
    for (const n of ["id", "role", "aria-label", "aria-hidden", "href", "alt", "type", "placeholder",
      "data-testid", "data-visualcompletion", "data-pagelet", "tabindex"]) {
      const v = el.getAttribute(n);
      if (v !== null) a.push(n + "=" + JSON.stringify(v.length > 80 ? v.slice(0, 80) + "…" : v));
    }
    return a.join(" ");
  }
  function ownText(el) {
    let t = "";
    for (const c of el.childNodes) if (c.nodeType === 3) t += c.nodeValue;
    t = t.trim().replace(/\s+/g, " ");
    if (!t) return "";
    if (privateText) return " text#" + t.length;
    return " " + JSON.stringify(t.length > 60 ? t.slice(0, 60) + "…" : t);
  }
  function walk(el, depth) {
    if (out.length > MAX) return;
    const tag = el.tagName.toLowerCase();
    if (tag === "script" || tag === "style" || tag === "noscript" || tag === "link" || tag === "meta") return;
    const cs = getComputedStyle(el);
    if (cs.display === "none") {
      out.push("  ".repeat(depth) + tag + " [hidden" + (el.classList.contains("cg-hide") ? " by cleangram" : "") + "] " + attrs(el));
      return;
    }
    const r = el.getBoundingClientRect();
    const pos = cs.position === "fixed" || cs.position === "sticky" ? " " + cs.position : "";
    out.push("  ".repeat(depth) + tag + " " + attrs(el) + pos
      + " @" + Math.round(r.left) + "," + Math.round(r.top) + " " + Math.round(r.width) + "x" + Math.round(r.height)
      + ownText(el));
    if (tag === "svg") return;
    for (const c of el.children) walk(c, depth + 1);
  }
  if (document.body) walk(document.body, 0);
  if (out.length > MAX) out.push("… (cut at " + MAX + " lines)");
  return out.join("\n");
})()
