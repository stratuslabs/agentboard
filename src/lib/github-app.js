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

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The cards a PR body links to on this instance, in order of first mention:
 * permalinks (`<origin>/c/<id or key>`) and board links (`...?card=<id>`).
 * Links to any other host are ignored. `Closes #N` is not a card reference:
 * on GitHub, #N is an issue in the PR's own repository.
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
  // Both forms need a "/" straight after the origin, so a longer host
  // (app.agentboard.to.evil.example) or another port never matches.
  const prefix = escapeRegExp(base);
  const pattern = new RegExp(
    `${prefix}(?:/c/([A-Za-z0-9-]*[A-Za-z0-9])(?![\\w-]|/[\\w])|/[^\\s)\\]>"'?#]*\\?(?:[^\\s)\\]>"'#]*&)?card=([0-9]+)\\b)`,
    "gi"
  );
  // A permalink must end at the reference: /c/12_draft or /c/12/x is not card 12.
  const refs = [];
  for (const match of body.matchAll(pattern)) {
    const ref = match[1] ?? match[2];
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
