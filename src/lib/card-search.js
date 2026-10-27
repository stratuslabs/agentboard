"use strict";

/**
 * Card search: one reading of what someone typed, shared by the board's text
 * filter (in the browser, over the cards it already has) and the Cmd+K quick
 * search (on the server, across every board in the team).
 *
 * A query is split into words. A card matches when every word matches it:
 *
 *  - as text, anywhere in the title, description or labels, any case;
 *  - or, when the word is a card reference, as that card exactly. `AB-12`
 *    is the card whose key is AB-12 (not AB-120), and `#41` or `41` is the
 *    card with id 41 or number 41 in its product, the two numbers the UI
 *    shows.
 *
 * Words are capped in count and length so a pasted paragraph can't become a
 * forty-clause query.
 *
 * CommonJS like card-keys.js, so the route, the client and the tests share it.
 */

const { parseCardRef } = require("./card-keys");

/** Most words a query is read for, and the longest a word may be. */
const MAX_TERMS = 8;
const MAX_TERM_LENGTH = 100;

/**
 * @typedef {{ id: number } | { key: string, number: number }} CardRef
 * @typedef {{ terms: string[], refs: CardRef[] }} SearchQuery
 */

/**
 * The words in a query, lowercased and deduplicated, and the card references
 * among them. A reference is also kept as a word, since a title can contain
 * "2026" or "OKB-3" too.
 *
 * @param {unknown} raw
 * @returns {SearchQuery}
 */
function parseSearchQuery(raw) {
  const text = typeof raw === "string" ? raw : "";
  const terms = [];
  for (const word of text.toLowerCase().split(/\s+/)) {
    if (!word) continue;
    const term = word.slice(0, MAX_TERM_LENGTH);
    if (!terms.includes(term)) terms.push(term);
    if (terms.length === MAX_TERMS) break;
  }
  const refs = [];
  for (const term of terms) {
    const ref = termRef(term);
    if (ref) refs.push(ref);
  }
  return { terms, refs };
}

/**
 * The card a word refers to: `ab-12`, `#41` or `41`. Null for anything else.
 *
 * @param {string} term
 * @returns {CardRef | null}
 */
function termRef(term) {
  return parseCardRef(term.startsWith("#") ? term.slice(1) : term);
}

/**
 * @param {CardRef} ref
 * @param {{ id: number, number?: number | null, key?: string | null }} card
 * @param {string | null | undefined} productKey
 */
function refMatches(ref, card, productKey) {
  if ("id" in ref) return card.id === ref.id || (card.number != null && card.number === ref.id);
  const key = card.key || (productKey && card.number != null ? `${productKey}-${card.number}` : null);
  return key !== null && key.toUpperCase() === `${ref.key}-${ref.number}`;
}

/**
 * Whether a card matches a query. An empty query matches every card.
 *
 * @param {{ id: number, number?: number | null, key?: string | null, title?: string | null, description?: string | null, labels?: string | null }} card
 * @param {unknown} query the raw text, or an already parsed SearchQuery
 * @param {string | null} [productKey] the board's product key, for cards loaded without their own
 * @returns {boolean}
 */
function cardMatchesSearch(card, query, productKey) {
  const { terms } = query && typeof query === "object" && "terms" in query ? query : parseSearchQuery(query);
  if (terms.length === 0) return true;
  const text = [card.title, card.description, card.labels]
    .filter((v) => typeof v === "string")
    .join("\n")
    .toLowerCase();
  return terms.every((term) => {
    if (text.includes(term)) return true;
    const ref = termRef(term);
    return ref !== null && refMatches(ref, card, productKey);
  });
}

/**
 * A word for a LIKE/ILIKE pattern with its wildcards matched literally. The
 * pattern needs no ESCAPE clause: backslash is Postgres's default.
 *
 * @param {string} term
 * @returns {string}
 */
function escapeLike(term) {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`);
}

module.exports = {
  MAX_TERMS,
  MAX_TERM_LENGTH,
  parseSearchQuery,
  cardMatchesSearch,
  escapeLike,
};
