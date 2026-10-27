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
 * Shared by the board (client), the search route and the tests.
 */

import { parseCardRef } from "./card-keys";

/** Most words a query is read for, and the longest a word may be. */
export const MAX_TERMS = 8;
export const MAX_TERM_LENGTH = 100;

export type CardRef = { id: number } | { key: string; number: number };
export interface SearchQuery {
  terms: string[];
  refs: CardRef[];
}

export interface SearchableCard {
  id: number;
  number?: number | null;
  key?: string | null;
  title?: string | null;
  description?: string | null;
  labels?: string | null;
}

/**
 * The words in a query, lowercased and deduplicated, and the card references
 * among them. A reference is also kept as a word, since a title can contain
 * "2026" or "OKB-3" too.
 */
export function parseSearchQuery(raw: unknown): SearchQuery {
  const text = typeof raw === "string" ? raw : "";
  const terms: string[] = [];
  for (const word of text.toLowerCase().split(/\s+/)) {
    if (!word) continue;
    const term = word.slice(0, MAX_TERM_LENGTH);
    if (!terms.includes(term)) terms.push(term);
    if (terms.length === MAX_TERMS) break;
  }
  const refs: CardRef[] = [];
  for (const term of terms) {
    const ref = termRef(term);
    if (ref) refs.push(ref);
  }
  return { terms, refs };
}

/** The card a word refers to: `ab-12`, `#41` or `41`. Null for anything else. */
function termRef(term: string): CardRef | null {
  return parseCardRef(term.startsWith("#") ? term.slice(1) : term);
}

function refMatches(ref: CardRef, card: SearchableCard, productKey: string | null | undefined): boolean {
  if ("id" in ref) return card.id === ref.id || (card.number != null && card.number === ref.id);
  const key = card.key || (productKey && card.number != null ? `${productKey}-${card.number}` : null);
  return key !== null && key.toUpperCase() === `${ref.key}-${ref.number}`;
}

/**
 * Whether a card matches a query, given as the raw text or already parsed.
 * An empty query matches every card. `productKey` is the board's, for cards
 * loaded without their own key.
 */
export function cardMatchesSearch(card: SearchableCard, query: unknown, productKey?: string | null): boolean {
  const { terms } = isParsed(query) ? query : parseSearchQuery(query);
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

function isParsed(query: unknown): query is SearchQuery {
  return typeof query === "object" && query !== null && Array.isArray((query as SearchQuery).terms);
}

/**
 * A word for a LIKE/ILIKE pattern with its wildcards matched literally. The
 * pattern needs no ESCAPE clause: backslash is Postgres's default.
 */
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`);
}
