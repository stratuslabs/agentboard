// The team's product keys, for card references in a description. A key on the
// standards stoplist (TLS, UTC, ...) links only when the app knows it names a
// real product, and a card on its own knows just its own product's key, so
// TLS-13 written on an AB card needs the rest (AB-148).
//
// A load that fails returns no keys: those references stay text, as they did
// before, and nothing else on the card depends on this.

/**
 * GET /api/products: every product in the team, each with its current key.
 *
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<string[]>}
 */
export async function loadTeamProductKeys(fetchImpl = fetch) {
  try {
    const res = await fetchImpl("/api/products");
    if (!res.ok) return [];
    const products = await res.json();
    if (!Array.isArray(products)) return [];
    return products
      .map((p) => (p && typeof p === "object" ? p.key : null))
      .filter((key) => typeof key === "string" && key !== "");
  } catch {
    return [];
  }
}
