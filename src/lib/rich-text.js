// Light formatting for card descriptions.
//
// Descriptions stay plain text in the database and the API. This turns that
// text into a small tree for display: paragraphs with line breaks, bullet and
// numbered lists, headings, links, `code`, **bold** and references to other
// cards (AB-142, "card #57"). It is deliberately not
// a full Markdown parser, and it never produces HTML, so nothing in a
// description can inject markup. Links are only made for http(s) and mailto.
//
// Plain JavaScript with JSDoc types so `node --test` can run it on the Node
// version CI uses, without a build step.

/**
 * @typedef {{ type: "text", text: string }
 *   | { type: "code", text: string }
 *   | { type: "strong", children: Inline[] }
 *   | { type: "link", href: string, children: Inline[] }
 *   | { type: "card", ref: string, children: Inline[] }} Inline
 * @typedef {Inline[]} Line
 * @typedef {{ type: "paragraph", lines: Line[] }
 *   | { type: "heading", level: number, content: Line }
 *   | { type: "list", ordered: boolean, start: number, items: Line[][] }} Block
 */

const BULLET = /^ {0,3}[-*•][ \t]+(.*)$/;
const ORDERED = /^ {0,3}(\d{1,9})[.)][ \t]+(.*)$/;
const HEADING = /^ {0,3}(#{1,6})[ \t]+(.*?)[ \t]*$/;
const CONTINUATION = /^[ \t]+\S/;

const SAFE_HREF = /^(https?:\/\/|mailto:)/i;

/**
 * @param {string | null | undefined} source
 * @returns {Block[]}
 */
export function parseRichText(source) {
  if (!source) return [];
  /** @type {Block[]} */
  const blocks = [];
  /** @type {Block | null} */
  let current = null;
  const close = () => {
    if (current) blocks.push(current);
    current = null;
  };

  for (const raw of source.replace(/\r\n?/g, "\n").split("\n")) {
    if (!raw.trim()) {
      close();
      continue;
    }

    const heading = HEADING.exec(raw);
    if (heading && heading[2]) {
      close();
      blocks.push({ type: "heading", level: heading[1].length, content: parseInline(heading[2]) });
      continue;
    }

    const bullet = BULLET.exec(raw);
    const ordered = bullet ? null : ORDERED.exec(raw);
    if (bullet || ordered) {
      const isOrdered = Boolean(ordered);
      const body = bullet ? bullet[1] : /** @type {RegExpExecArray} */ (ordered)[2];
      if (!current || current.type !== "list" || current.ordered !== isOrdered) {
        close();
        current = { type: "list", ordered: isOrdered, start: ordered ? Number(ordered[1]) : 1, items: [] };
      }
      current.items.push([parseInline(body.trim())]);
      continue;
    }

    if (current && current.type === "list" && CONTINUATION.test(raw)) {
      current.items[current.items.length - 1].push(parseInline(raw.trim()));
      continue;
    }

    if (!current || current.type !== "paragraph") {
      close();
      current = { type: "paragraph", lines: [] };
    }
    current.lines.push(parseInline(raw.trim()));
  }
  close();
  return blocks;
}

// One pass over each line. Earlier alternatives win at the same position, so a
// code span hides any markers or URLs inside it.
const INLINE = /`([^`\n]+)`|\[([^\]\n]+)\]\(([^()\s]+)\)|\*\*(?=\S)([^\n]*?\S)\*\*|((?:https?:\/\/|mailto:)[^\s<>"'`]+)/gi;

/**
 * @param {string} line
 * @param {{ links?: boolean }} [options]
 * @returns {Line}
 */
export function parseInline(line, options = {}) {
  const links = options.links !== false;
  /** @type {Line} */
  const out = [];
  const pushNode = (/** @type {Inline} */ n) => {
    const last = out[out.length - 1];
    if (n.type === "text" && last && last.type === "text") last.text += n.text;
    else out.push(n);
  };
  // Plain text between constructs, line[from, to). Card references are found
  // here, against the whole line so their boundaries see the real neighbors.
  // `raw` text (a rejected link, an unusable URL) is kept exactly as written.
  const pushText = (/** @type {number} */ from, /** @type {number} */ to, raw = false) => {
    if (from >= to) return;
    if (links && !raw) linkCardRefs(line, from, to).forEach(pushNode);
    else pushNode({ type: "text", text: line.slice(from, to) });
  };

  const re = new RegExp(INLINE.source, INLINE.flags);
  let pos = 0;
  let m;
  while ((m = re.exec(line))) {
    const start = m.index;
    let end = start + m[0].length;
    if (m[1] !== undefined) {
      pushText(pos, start);
      out.push({ type: "code", text: m[1] });
    } else if (m[2] !== undefined) {
      if (!links || !SAFE_HREF.test(m[3])) {
        // Leave the whole thing as written, label included.
        pushText(pos, start);
        pushText(start, end, true);
      } else {
        pushText(pos, start);
        out.push({ type: "link", href: m[3], children: parseInline(m[2], { links: false }) });
      }
    } else if (m[4] !== undefined) {
      pushText(pos, start);
      out.push({ type: "strong", children: parseInline(m[4], options) });
    } else {
      const url = trimUrl(m[5]);
      end = start + url.length;
      re.lastIndex = end;
      pushText(pos, start);
      if (links && /^(https?:\/\/[^/]|mailto:.)/i.test(url)) out.push({ type: "link", href: url, children: [{ type: "text", text: url }] });
      else pushText(start, end, true);
    }
    pos = end;
  }
  pushText(pos, line.length);
  return out;
}

// A card key as the app prints it, AB-142: uppercase only, so prose like
// "covid-19" stays prose. Not glued to a word, path, mention or version
// (repo/AB-1, #AB-1, AB-1/path, owner+AB-1@host, AB-1.5, AB-1-2).
const CARD_KEY = /(?<![A-Za-z0-9_/#@.\-])([A-Z][A-Z0-9]{1,9}-[1-9][0-9]{0,9})(?![A-Za-z0-9_/@]|[-.][0-9])/;
// A card without a key, written the way the app labels it, "#57", but only
// after the word "card": on its own, #57 is usually a PR or an issue.
const CARD_ID = /(?<=(?<![A-Za-z0-9_])[Cc]ards? )#([1-9][0-9]{0,9})(?![A-Za-z0-9_])/;
const CARD_REF = new RegExp(`${CARD_KEY.source}|${CARD_ID.source}`, "g");

// Prefixes that read like a card key but are standards, hashes or time zones:
// UTF-8, ISO-8601, SHA-256, CVE-2026, UTC-5.
const NOT_CARD_KEYS = new Set(["UTF", "ISO", "SHA", "CVE", "RFC", "HTTP", "TLS", "PEP", "ES", "GPT", "UTC", "GMT"]);

/**
 * Split line[from, to) into text and card references. A reference only names
 * the card: it links to /c/<ref>, which the app resolves (old keys included)
 * or answers with its not-found page.
 * @param {string} line
 * @param {number} from
 * @param {number} to
 * @returns {Inline[]}
 */
function linkCardRefs(line, from, to) {
  /** @type {Inline[]} */
  const out = [];
  const re = new RegExp(CARD_REF.source, CARD_REF.flags);
  re.lastIndex = from;
  let pos = from;
  let m;
  while ((m = re.exec(line)) && m.index + m[0].length <= to) {
    const key = m[1];
    if (key && NOT_CARD_KEYS.has(key.slice(0, key.indexOf("-")))) continue;
    if (m.index > pos) out.push({ type: "text", text: line.slice(pos, m.index) });
    out.push({ type: "card", ref: key ?? m[2], children: [{ type: "text", text: m[0] }] });
    pos = m.index + m[0].length;
  }
  if (pos < to) out.push({ type: "text", text: line.slice(pos, to) });
  return out;
}

/** Drop sentence punctuation and unbalanced closing parens from a bare URL. */
function trimUrl(/** @type {string} */ url) {
  for (;;) {
    if (/[.,;:!?*_]$/.test(url)) {
      url = url.slice(0, -1);
    } else if (url.endsWith(")") && count(url, ")") > count(url, "(")) {
      url = url.slice(0, -1);
    } else {
      return url;
    }
  }
}

function count(/** @type {string} */ s, /** @type {string} */ ch) {
  return s.split(ch).length - 1;
}
