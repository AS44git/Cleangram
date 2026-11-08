/*
 * Cleangram: reads the Stories row on Instagram's Home page (in the app's hidden view) and
 * returns it as data: who, their picture, whether you've seen it. Only what the page already
 * shows; nothing is requested. Evaluated by the app; returns a JSON string (or "").
 */
(() => {
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
  const tray = findTray();
  if (!tray) return "";
  const out = [];
  const seenUsers = new Set();
  for (const img of tray.querySelectorAll("img[alt]")) {
    const alt = img.getAttribute("alt") || "";
    const m = alt.match(/^(.+?)['’]s profile picture$/i);
    if (!m) continue;
    // The item: the largest ancestor (inside the tray) holding just this one picture.
    let item = img;
    while (item.parentElement && item.parentElement !== tray
           && item.parentElement.querySelectorAll("img[alt]").length === 1) item = item.parentElement;
    const label = (item.innerText || "").trim().split("\n").filter(Boolean).pop() || m[1];
    const aria = ((item.closest("[aria-label]") || item).getAttribute("aria-label") || "") + " " +
      Array.from(item.querySelectorAll("[aria-label]")).map(e => e.getAttribute("aria-label")).join(" ");
    const mine = /^your story$/i.test(label);
    const user = m[1];
    if (seenUsers.has(user)) continue;
    seenUsers.add(user);
    out.push({
      user,
      label: mine ? "Your story" : label,
      img: img.currentSrc || img.src || "",
      mine,
      seen: /\bseen\b/i.test(aria) && !/not seen|unseen/i.test(aria),
      ring: !!item.querySelector("canvas"),   // Instagram draws the ring of a live story
    });
  }
  return out.length ? JSON.stringify(out) : "";
})()
