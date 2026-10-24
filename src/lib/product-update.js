// Plain JavaScript with JSDoc types so `node --test` can import it.

import cardKeys from "./card-keys.js";
import { slugify } from "./slug.js";

const { changeProductKey } = cardKeys;

/**
 * The PATCH /api/products/:id writes, as the route does them today: the key
 * first, then each other field. Moved here unchanged so it can be tested.
 *
 * @param {{ query: (text: string, values?: unknown[]) => Promise<any> }} client
 * @param {number} productId
 * @param {{ key?: string, name?: string, emoji?: string, defaultBoard?: { present: boolean, value: number | null } }} patch
 */
export async function updateProduct(client, productId, patch) {
  const query = (text, values) => client.query(text, values);
  if (patch.key !== undefined) {
    const changed = await changeProductKey(query, productId, patch.key);
    if ("error" in changed) return changed;
  }
  try {
    if (patch.name) {
      await query("UPDATE products SET name = $1, slug = $2 WHERE id = $3", [patch.name, slugify(patch.name), productId]);
    }
  } catch (err) {
    if (err && err.code === "23505") return { error: "Product already exists in this org", status: 409 };
    throw err;
  }
  const { rows } = await query("SELECT * FROM products WHERE id = $1", [productId]);
  return { product: rows[0] };
}
