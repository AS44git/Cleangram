/*
 * Cleangram: reads the Stories row on Instagram's Home page (in the app's hidden view) and
 * returns it as data: who, their picture, whether you've seen it. Only what the page already
 * shows; nothing is requested. Evaluated by the app; returns a JSON string (or "").
 */
(() => {
  const PIC = /profile picture/i;
  // Pictures that could be in the Stories row: not in a post, not a link to someone's profile.
  function candidates() {
    return Array.from(document.querySelectorAll("img[alt]")).filter((img) =>
      PIC.test(img.getAttribute("alt") || "") && !img.closest("article") &&
      !(img.closest("a[href]") && !/^\/stories\//.test(img.closest("a[href]").getAttribute("href") || "")));
  }

  function findTray() {
    const imgs = candidates();
    if (!imgs.length) return null;
    // 1. The topmost sideways-scrolling row of pictures (how the phone site lays it out).
    let best = null;
    for (const img of imgs) {
      for (let el = img.parentElement, i = 0; el && el !== document.body && i < 12; el = el.parentElement, i++) {
        const ox = getComputedStyle(el).overflowX;
        if ((ox === "auto" || ox === "scroll" || ox === "hidden") && el.scrollWidth > el.clientWidth + 8) {
          const top = el.getBoundingClientRect().top + scrollY;
          if (!best || top < best.top) best = { el, top };
          break;
        }
      }
    }
    if (best && best.el.querySelectorAll("img[alt]").length >= 1) return best.el;
    // 2. Otherwise: the smallest box holding the first few pictures, in page order.
    const want = Math.min(3, imgs.length);
    for (let el = imgs[0].parentElement, i = 0; el && el !== document.body && i < 14; el = el.parentElement, i++) {
      const n = imgs.filter((x) => el.contains(x)).length;
      if (n >= want && (want > 1 || i >= 3)) return el;
    }
    return null;
  }

  const ME = String("__CG_ME__").toLowerCase();
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
    const mine = /^your story$/i.test(label) || m[1].toLowerCase() === ME;
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
  // "Your story" always comes first, as in the app (with a + when there's no story up).
  const at = out.findIndex((s) => s.mine);
  if (at > 0) out.unshift(out.splice(at, 1)[0]);
  if (at < 0 && /^[a-z0-9._]{1,30}$/.test(ME)) {
    const pic = Array.from(document.querySelectorAll("img[alt]"))
      .find((i) => (i.getAttribute("alt") || "").toLowerCase().replace("’", "'") === ME + "'s profile picture");
    out.unshift({ user: ME, label: "Your story", img: pic ? (pic.currentSrc || pic.src || "") : "", mine: true, seen: false, ring: false });
  }
  return out.length ? JSON.stringify(out) : "";
})()
