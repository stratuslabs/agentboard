// "/" on a desktop goes on to the product you last opened. On a phone "/" is
// the sidebar screen and never redirects.
//
// The home page starts this from an effect, and the effect's inputs can change
// while the lookups are in flight: reaching "/" by a client-side navigation
// from Settings mounts the board frame fresh, so the page's effect first runs
// before the frame has set isMobile, then again once it has. A lookup started
// on the first run used to redirect a phone anyway (AB-160). Cancelling here
// means only the latest run can act.

/**
 * Restore the last product from "/", unless this is a phone.
 *
 * @param {{
 *   onPhone: boolean,
 *   selected: { productId: number, orgId: number } | null,
 *   fetchJson: (url: string) => Promise<unknown>,
 *   go: (path: string) => void,
 *   stay: () => void,
 * }} opts
 *   go: open the product's board. stay: show "/" as it is.
 * @returns {() => void} cancel, for the effect's cleanup: after it, neither go nor stay is called.
 */
export function restoreLastProduct({ onPhone, selected, fetchJson, go, stay }) {
  if (onPhone || !selected) {
    stay();
    return () => {};
  }
  let cancelled = false;
  const { productId, orgId } = selected;
  Promise.all([fetchJson("/api/orgs"), fetchJson(`/api/products?org_id=${orgId}`)])
    .then(([orgs, products]) => {
      if (cancelled) return;
      const org = Array.isArray(orgs) ? orgs.find((o) => o.id === orgId) : undefined;
      const product = Array.isArray(products) ? products.find((p) => p.id === productId) : undefined;
      if (org && product) go(`/${org.slug}/${product.slug}`);
      else stay();
    })
    .catch(() => {
      if (!cancelled) stay();
    });
  return () => {
    cancelled = true;
  };
}
