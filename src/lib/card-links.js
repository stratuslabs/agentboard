// Card links: any URL a card points at, such as a Slack thread, a doc or a
// design, next to its GitHub issue and PR fields. The API validates every
// link with these rules, and the app and the CLI label links the same way.
//
// Plain JavaScript with JSDoc types so `node --test` can run it on the Node
// version CI uses, without a build step.

/** Longest link URL, in characters. Browsers and proxies balk past this. */
export const MAX_LINK_URL = 2048;

/** Longest link title, in characters. A title is a label, not a note. */
export const MAX_LINK_TITLE = 200;

/**
 * @typedef {{ id: number, card_id: number, url: string, title: string | null,
 *   created_at: string }} CardLink
 */

/**
 * @template T
 * @typedef {{ ok: true, value: T } | { ok: false, error: string }} Result
 */

/** @param {unknown} body */
function isObject(body) {
  return typeof body === "object" && body !== null && !Array.isArray(body);
}

/**
 * A link URL: an absolute http(s) URL, trimmed and otherwise kept as written,
 * so the same link sent twice matches. Other schemes are refused because the
 * app renders links as hrefs, where `javascript:` would run.
 * @param {unknown} raw
 * @returns {Result<string>}
 */
export function parseLinkUrl(raw) {
  if (typeof raw !== "string") return { ok: false, error: "url is required and must be a string" };
  const url = raw.trim();
  if (!url) return { ok: false, error: "url must not be empty" };
  if (url.length > MAX_LINK_URL) {
    return { ok: false, error: `url must be at most ${MAX_LINK_URL} characters` };
  }
  // Check the raw prefix too: new URL() accepts `https:example.com`, which a
  // browser resolves as a same-origin path when it is used as an href.
  if (!/^https?:\/\//i.test(url)) {
    return { ok: false, error: "url must start with http:// or https://" };
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: "url must be a full http:// or https:// URL" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: "url must start with http:// or https://" };
  }
  return { ok: true, value: url };
}

/**
 * @param {unknown} raw
 * @returns {Result<string | null>}
 */
function parseLinkTitle(raw) {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (typeof raw !== "string") return { ok: false, error: "title must be a string" };
  const title = raw.replace(/\s+/g, " ").trim();
  if (!title) return { ok: true, value: null };
  if (title.length > MAX_LINK_TITLE) {
    return { ok: false, error: `title must be at most ${MAX_LINK_TITLE} characters` };
  }
  return { ok: true, value: title };
}

/**
 * A link from a request body: `{ url, title? }`.
 * @param {unknown} body
 * @returns {Result<{ url: string, title: string | null }>}
 */
export function parseCardLink(body) {
  if (!isObject(body)) return { ok: false, error: "body must be a JSON object with a url" };
  const b = /** @type {Record<string, unknown>} */ (body);
  const url = parseLinkUrl(b.url);
  if (!url.ok) return url;
  const title = parseLinkTitle(b.title);
  if (!title.ok) return title;
  return { ok: true, value: { url: url.value, title: title.value } };
}

/**
 * What a link shows: its title, else the URL without the scheme or a bare
 * trailing slash.
 * @param {{ url: string, title?: string | null }} link
 */
export function linkLabel(link) {
  if (link.title) return link.title;
  return link.url.replace(/^https?:\/\//i, "").replace(/\/$/, "");
}
