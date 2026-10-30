/**
 * Products were added, renamed, deleted, reordered or moved between orgs.
 *
 * The sidebar announces this after its own product changes, so a page that
 * shows the same products (the org page) can refetch instead of going stale
 * until a reload.
 */
export const PRODUCTS_CHANGED = "agentboard:products-changed";

export function announceProductsChanged() {
  window.dispatchEvent(new Event(PRODUCTS_CHANGED));
}
