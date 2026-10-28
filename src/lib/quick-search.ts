/**
 * The pieces of the Cmd+K quick search that other components need: an event
 * to open the dialog (the sidebar's Search button), and an event a board
 * listens for to open a card it already has on screen.
 *
 * A result normally opens at the card's permanent link, `/c/<key>`, which
 * redirects to the product page with `?card=`. A board reads that parameter
 * when it mounts, so when the card lives in the product already on screen the
 * same navigation would change the URL and open nothing. The dialog sends the
 * board OPEN_CARD_EVENT instead, and a board that takes it says so by calling
 * preventDefault(). When no board answers (it is still loading), the dialog
 * writes `?card=` into the address bar so the board picks it up when it mounts.
 */

/** Dispatched on window to open the quick search dialog. */
export const QUICK_SEARCH_EVENT = "agentboard:quick-search";

/**
 * Dispatched on window with `{ cardId }` for the board on screen to open. It is
 * cancelable: a board that handles it calls preventDefault().
 */
export const OPEN_CARD_EVENT = "agentboard:open-card";

export interface OpenCardDetail {
  cardId: number;
}

/** A row from GET /api/cards/search. */
export interface SearchResult {
  id: number;
  number: number | null;
  key: string | null;
  title: string;
  priority: string;
  labels: string;
  product_key: string | null;
  product_name: string;
  product_slug: string;
  product_emoji: string | null;
  org_name: string;
  org_slug: string;
  board_name: string;
  column_name: string;
  column_color: string | null;
  done: boolean;
  assignee_name: string | null;
}

/** How the shortcut reads on this machine: ⌘K on Apple platforms, Ctrl K elsewhere. */
export function searchShortcut(): string {
  const platform = typeof navigator === "undefined" ? "" : navigator.platform || navigator.userAgent;
  return /Mac|iPhone|iPad|iPod/i.test(platform) ? "⌘K" : "Ctrl K";
}

/**
 * Ask the board on screen to open a card. Returns false when no mounted board
 * took it, so the caller can fall back to the `?card=` link.
 */
export function requestOpenCard(cardId: number): boolean {
  const event = new CustomEvent<OpenCardDetail>(OPEN_CARD_EVENT, { detail: { cardId }, cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

export function openQuickSearch(): void {
  window.dispatchEvent(new Event(QUICK_SEARCH_EVENT));
}

/** The product page a result lives on, as it appears in the address bar. */
export function productPath(result: Pick<SearchResult, "org_slug" | "product_slug">): string {
  return `/${encodeURIComponent(result.org_slug)}/${encodeURIComponent(result.product_slug)}`;
}

/** The result's permanent link, `/c/AB-12`, or `/c/<id>` without a key. */
export function resultHref(result: Pick<SearchResult, "id" | "key">): string {
  return `/c/${encodeURIComponent(result.key ?? String(result.id))}`;
}
