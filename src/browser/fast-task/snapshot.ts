/**
 * What the page looks like, as a numbered list.
 *
 * The fast loop never looks at a screenshot. It reads the controls a person
 * could actually use — visible, on screen, not covered — numbers them, and
 * hands that list to the decision model. The model answers with one of those
 * numbers, so it can never name an element that was not offered to it.
 *
 * The whole read happens in one call inside the page, so every control in a
 * snapshot is measured against the same layout. Reading them one at a time
 * would let the page move underneath the read.
 */

export interface Control {
  /** Position in this snapshot. Only ever meaningful within one snapshot. */
  i: number;
  tag: string;
  role: string;
  name: string;
  value: string;
  /** Centre point, in viewport coordinates, for a real mouse event. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Cheap identity check, so a stale index can be spotted before it is used. */
  sig: string;
}

export interface PageSnapshot {
  url: string;
  title: string;
  controls: Control[];
  /** Page text, trimmed: enough for the model to know where it is. */
  text: string;
  scrollY: number;
  scrollHeight: number;
  viewportHeight: number;
}

/**
 * Runs in the page. Returns JSON, because CDP hands back a string far more
 * cheaply than it serialises a deep object.
 */
export const SNAPSHOT_JS = `(() => {
  const MAX_CONTROLS = 120;
  const MAX_TEXT = 2000;
  const vw = window.innerWidth, vh = window.innerHeight;

  const isInteractive = (el) => {
    const tag = el.tagName.toLowerCase();
    if (["a","button","input","textarea","select","summary","option"].includes(tag)) return true;
    if (el.isContentEditable) return true;
    const role = el.getAttribute("role");
    if (role && ["button","link","textbox","checkbox","radio","combobox","menuitem","tab","option","switch","searchbox"].includes(role)) return true;
    if (el.hasAttribute("onclick")) return true;
    if (el.tabIndex >= 0 && tag !== "body") return true;
    return false;
  };

  const nameOf = (el) => {
    const pick = (s) => (s || "").replace(/\\s+/g, " ").trim().slice(0, 100);
    return pick(
      el.getAttribute("aria-label") ||
      el.getAttribute("placeholder") ||
      el.getAttribute("title") ||
      el.getAttribute("alt") ||
      (el.labels && el.labels[0] && el.labels[0].textContent) ||
      el.textContent ||
      el.getAttribute("name") ||
      el.id
    );
  };

  const out = [];
  const seen = new Set();
  for (const el of document.querySelectorAll("*")) {
    if (out.length >= MAX_CONTROLS) break;
    if (!isInteractive(el)) continue;

    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    // Off screen: the model can only act on what is actually reachable now.
    if (r.bottom <= 0 || r.top >= vh || r.right <= 0 || r.left >= vw) continue;

    const style = getComputedStyle(el);
    if (style.visibility === "hidden" || style.display === "none" || Number(style.opacity) === 0) continue;
    if (el.disabled) continue;

    const x = Math.round(Math.min(Math.max(r.left + r.width / 2, 1), vw - 1));
    const y = Math.round(Math.min(Math.max(r.top + r.height / 2, 1), vh - 1));

    // Covered by something else (a dialog, a sticky bar): clicking would hit
    // the wrong thing, so it is not offered at all.
    const top = document.elementFromPoint(x, y);
    if (top && top !== el && !el.contains(top) && !top.contains(el)) continue;

    const tag = el.tagName.toLowerCase();
    const name = nameOf(el);
    const value = String(el.value ?? "").slice(0, 100);
    const key = tag + "|" + name + "|" + Math.round(r.top) + "|" + Math.round(r.left);
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      i: out.length,
      tag,
      role: el.getAttribute("role") || (el.type ? tag + ":" + el.type : tag),
      name,
      value,
      x, y,
      w: Math.round(r.width),
      h: Math.round(r.height),
      sig: tag + "|" + name.slice(0, 40) + "|" + Math.round(r.width) + "x" + Math.round(r.height),
    });
  }

  return JSON.stringify({
    url: location.href,
    title: document.title,
    controls: out,
    text: (document.body ? document.body.innerText : "").replace(/\\n{3,}/g, "\\n\\n").slice(0, MAX_TEXT),
    scrollY: Math.round(window.scrollY),
    scrollHeight: Math.round(document.documentElement.scrollHeight),
    viewportHeight: vh,
  });
})()`;

/** The snapshot as the decision model sees it: a numbered table, nothing else. */
export function renderState(snap: PageSnapshot, goal: string, history: string[]): string {
  const lines = snap.controls.map(
    (c) => `[${c.i}] ${c.role} "${c.name}"${c.value ? ` value="${c.value}"` : ""}`
  );
  const scrolled =
    snap.scrollHeight > snap.viewportHeight
      ? `Scrolled ${snap.scrollY} of ${snap.scrollHeight - snap.viewportHeight} px.`
      : "Whole page fits on screen.";
  return [
    `GOAL: ${goal}`,
    "",
    `PAGE: ${snap.title}`,
    `URL: ${snap.url}`,
    scrolled,
    "",
    "WHAT HAS HAPPENED SO FAR:",
    history.length ? history.map((h, n) => `${n + 1}. ${h}`).join("\n") : "Nothing yet.",
    "",
    "CONTROLS ON SCREEN:",
    lines.length ? lines.join("\n") : "None.",
    "",
    "PAGE TEXT:",
    snap.text,
  ].join("\n");
}
