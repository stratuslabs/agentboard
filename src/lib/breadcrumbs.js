// Links for the full card page's breadcrumbs (card 805). The product and
// board crumbs are real links, so cmd-click and middle-click open a new tab.
// A board has no path of its own, so the board crumb carries `?board=<id>`
// and the board page opens that board instead of the product's first one.
//
// Plain JavaScript with JSDoc types so `node --test` can run it without a
// build step.

/** @param {unknown} id */
function isId(id) {
  return typeof id === "number" && Number.isInteger(id) && id > 0;
}

/**
 * `/<org>/<product>`, or null when either slug is missing.
 *
 * @param {string | null | undefined} orgSlug
 * @param {string | null | undefined} productSlug
 * @returns {string | null}
 */
export function productHref(orgSlug, productSlug) {
  if (!orgSlug || !productSlug) return null;
  return `/${encodeURIComponent(orgSlug)}/${encodeURIComponent(productSlug)}`;
}

/**
 * `/<org>/<product>?board=<id>`. Without a usable board id it's the product
 * link, which opens the first board.
 *
 * @param {string | null | undefined} orgSlug
 * @param {string | null | undefined} productSlug
 * @param {number | null | undefined} boardId
 * @returns {string | null}
 */
export function boardHref(orgSlug, productSlug, boardId) {
  const base = productHref(orgSlug, productSlug);
  if (!base) return null;
  return isId(boardId) ? `${base}?board=${boardId}` : base;
}

/**
 * The board a `?board=` link asks for, or null.
 *
 * @param {string} search a query string, with or without the leading "?"
 * @returns {number | null}
 */
export function readBoardParam(search) {
  const raw = new URLSearchParams(search).get("board");
  if (!raw || !/^[0-9]+$/.test(raw)) return null;
  const id = Number(raw);
  return isId(id) ? id : null;
}

/**
 * The URL without its `board` parameter. The board page reads it once on
 * load; after that the tabs decide, so it shouldn't linger and contradict them.
 *
 * @param {string} href
 * @returns {string}
 */
export function stripBoardParam(href) {
  const url = new URL(href);
  url.searchParams.delete("board");
  return url.toString();
}

/**
 * Whether a click on a link is an ordinary one the page can handle itself.
 * Modified and middle clicks belong to the browser (new tab, new window).
 *
 * @param {{ button: number, metaKey: boolean, ctrlKey: boolean, shiftKey: boolean, altKey: boolean, defaultPrevented: boolean }} e
 * @returns {boolean}
 */
export function isPlainClick(e) {
  return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && !e.defaultPrevented;
}
