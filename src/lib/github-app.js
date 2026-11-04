// AgentBoard GitHub App (card 1000): when a linked pull request merges, its
// cards move to Done. These are the pure parts, with no database or network:
// the webhook signature check, PR URL normalization, card references in a PR
// body, and the History line written on the card.

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * True when `header` is GitHub's X-Hub-Signature-256 for `rawBody` under
 * `secret`: `sha256=` and the lowercase hex HMAC-SHA256 of the exact bytes
 * received. Compared in constant time. No secret never verifies.
 *
 * @param {string} secret
 * @param {Buffer | string} rawBody
 * @param {string | null | undefined} header
 */
export function verifySignature(secret, rawBody, header) {
  if (!secret || typeof header !== "string") return false;
  const match = /^sha256=([0-9a-f]{64})$/.exec(header);
  if (!match) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  return timingSafeEqual(expected, Buffer.from(match[1], "hex"));
}

/**
 * The most the webhook reads of a request body. GitHub's largest pull_request
 * payloads are well under 1 MB (a PR body is at most 65,536 characters), and
 * GitHub itself never sends more than 25 MB.
 */
export const WEBHOOK_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Read a request body, or null once it is longer than `maxBytes`. The
 * webhook is reachable without signing in and its signature can only be
 * checked over the whole body, so the size is bounded before buffering: a
 * declared Content-Length over the limit is refused unread, and a body that
 * streams past the limit is cancelled there.
 *
 * @param {Request} request
 * @param {number} maxBytes
 * @returns {Promise<Buffer | null>}
 */
export async function readBodyLimited(request, maxBytes) {
  const declared = request.headers.get("content-length");
  if (declared !== null && /^\s*\d+\s*$/.test(declared) && Number(declared) > maxBytes) {
    await request.body?.cancel().catch(() => {});
    return null;
  }
  if (!request.body) return Buffer.alloc(0);
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks, total);
}

const GITHUB_HOSTS = new Set(["github.com", "www.github.com"]);

/**
 * A GitHub pull request URL in one form, `https://github.com/<owner>/<repo>/pull/<n>`,
 * with owner and repo lowercased (GitHub treats them case-blind) and any tab
 * (/files, /commits/...), query or hash dropped. Anything that isn't a PR URL
 * on github.com is null, so it can never match.
 *
 * @param {unknown} raw
 * @returns {string | null}
 */
export function normalizePrUrl(raw) {
  if (typeof raw !== "string") return null;
  let url;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (!GITHUB_HOSTS.has(url.hostname.toLowerCase())) return null;
  const match = /^\/([^/]+)\/([^/]+)\/pull\/([1-9][0-9]*)(?:\/.*)?$/.exec(url.pathname);
  if (!match) return null;
  const [, owner, repo, number] = match;
  return `https://github.com/${owner.toLowerCase()}/${repo.toLowerCase()}/pull/${number}`;
}

// A URL in Markdown or prose runs until whitespace, quoting or a Markdown/HTML
// delimiter. Like GitHub's autolinker, trailing sentence punctuation is not
// part of it.
const URL_IN_TEXT = /https?:\/\/[^\s<>"'`()[\]{}|\\^]+/gi;
const TRAILING_PUNCTUATION = /[.,;:!?*_~]+$/;
// The card references the app accepts (CARD_PARAM_KEY/CARD_PARAM_ID in
// cards.ts, parseCardRef in card-keys.js).
const CARD_KEY = /^[A-Za-z][A-Za-z0-9]{1,9}-[1-9][0-9]{0,9}$/;
const CARD_ID = /^[1-9][0-9]{0,9}$/;

/**
 * The card a URL opens on this instance, read the way the app reads it: the
 * `/c/<ref>` path segment, or else the board's first `?card=` value. Null for
 * another origin, a URL with credentials, or a value the app would reject.
 *
 * @param {string} text
 * @param {string} base This instance's origin
 * @returns {string | null}
 */
function cardRefInUrl(text, base) {
  let url;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.origin !== base || url.username || url.password) return null;
  const permalink = /^\/c\/([^/]+)\/?$/.exec(url.pathname);
  let ref;
  if (permalink) {
    try {
      ref = decodeURIComponent(permalink[1]);
    } catch {
      return null;
    }
  } else {
    ref = url.searchParams.get("card");
  }
  return ref && (CARD_KEY.test(ref) || CARD_ID.test(ref)) ? ref : null;
}

/**
 * The cards a PR body links to on this instance, in order of first mention:
 * permalinks (`<origin>/c/<id or key>`) and board links (`...?card=<key or id>`).
 * Links to any other host are ignored. `Closes #N` is not a card reference:
 * on GitHub, #N is an issue in the PR's own repository.
 *
 * Each URL is parsed, not pattern-matched, so a reference is exactly the card
 * the app would open from that link: `?card=AB-12-old`, `/c/AB-12.5` and
 * `/c/12/x` link nothing, and `?card=AB-2&card=AB-1` links AB-2.
 *
 * Returns the references as written; the caller resolves them within the
 * installation's team, so a reference to another team's card finds nothing.
 *
 * @param {unknown} body
 * @param {string} origin This instance's public origin, e.g. https://app.agentboard.to
 * @returns {string[]}
 */
export function cardRefsInBody(body, origin) {
  if (typeof body !== "string" || !body || !origin) return [];
  let base;
  try {
    base = new URL(origin).origin;
  } catch {
    return [];
  }
  if (base === "null") return [];
  const refs = [];
  for (const [text] of body.matchAll(URL_IN_TEXT)) {
    const ref = cardRefInUrl(text.replace(TRAILING_PUNCTUATION, ""), base);
    if (ref && !refs.includes(ref)) refs.push(ref);
  }
  return refs;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * The History line for a closed PR, in the card format's "- Oct 31: ..." style.
 * The date is the UTC day the PR closed.
 *
 * @param {{ repo: string, number: number, url: string, outcome: "merged" | "closed" | "no-done-column", date: Date }} pr
 */
export function closeHistoryLine({ repo, number, url, outcome, date }) {
  const day = `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`;
  const what =
    outcome === "merged"
      ? "merged; moved to Done"
      : outcome === "no-done-column"
        ? "merged, but this board has no Done column"
        : "closed without merging";
  return `- ${day}: PR ${repo}#${number} ${what} (GitHub App) ${url}`;
}

// A section heading: "**History:**", "History:", "## History" and the like,
// alone on its line.
const HEADING = /^(?:#{1,6}\s+)?(?:\*\*)?([A-Za-z][A-Za-z ]*?)(?::\*\*|\*\*:|:)?(?:\*\*)?\s*$/;

function sectionName(line) {
  if (!/^(#{1,6}\s|\*\*|[A-Za-z][A-Za-z ]*:\s*$)/.test(line)) return null;
  const match = HEADING.exec(line.trim());
  return match ? match[1].trim().toLowerCase() : null;
}

/**
 * The card description with `line` added as the last entry of its History
 * section, or a new History section at the end when it has none. Everything
 * else is kept exactly as it was.
 *
 * @param {unknown} description
 * @param {string} line
 */
export function appendHistory(description, line) {
  const text = typeof description === "string" ? description : "";
  const lines = text.split("\n");
  const start = lines.findIndex((l) => sectionName(l) === "history");
  if (start === -1) {
    const trimmed = text.replace(/\s+$/, "");
    return trimmed ? `${trimmed}\n\n**History:**\n${line}` : `**History:**\n${line}`;
  }
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (sectionName(lines[i]) !== null) {
      end = i;
      break;
    }
  }
  // Insert after the section's last non-blank line, so blank lines before the
  // next section stay where they were.
  let last = end - 1;
  while (last > start && lines[last].trim() === "") last--;
  lines.splice(last + 1, 0, line);
  const result = lines.join("\n");
  return end === lines.length - 1 ? result.replace(/\n+$/, "") : result;
}
