// Plain JavaScript with JSDoc types so `node --test` can import it.

import cardKeys from "./card-keys.js";
import { planSlugName } from "./slug.js";

const { changeProductKey } = cardKeys;

/**
 * @typedef {object} ProductPatch
 * @property {string} [key] already validated with normalizeProductKey
 * @property {string} [name]
 * @property {string} [emoji]
 * @property {{ present: false } | { present: true, value: number | null }} [defaultBoard]
 */

/**
 * Apply PATCH /api/products/:id in one transaction, so a request that fails
 * on any field changes nothing: a new key is not kept when the new name's
 * slug is taken.
 *
 * Needs a connection of its own (see `withClient`), because the pool's query
 * may put each statement on a different one.
 *
 * @param {{ query: (text: string, values?: unknown[]) => Promise<any> }} client
 * @param {number} productId
 * @param {ProductPatch} patch
 * @returns {Promise<{ product: any } | { error: string, status: number }>}
 */
export async function updateProduct(client, productId, patch) {
  /** @param {string} text @param {unknown[]} [values] */
  const query = (text, values) => client.query(text, values);
  await query("BEGIN");
  try {
    if (patch.key !== undefined) {
      const changed = await changeProductKey(query, productId, patch.key);
      if ("error" in changed) {
        await query("ROLLBACK");
        return changed;
      }
    }
    if (patch.name) {
      // The slug stays: agent configs and URLs point at it (renaming General
      // to HQ once broke every config that said `general`). The new name
      // still can't be one another product in the org has, or makes.
      const { rows: siblings } = await query(
        "SELECT id, name, slug FROM products WHERE org_id = (SELECT org_id FROM products WHERE id = $1)",
        [productId]
      );
      const plan = planSlugName(PRODUCT, patch.name, siblings, productId);
      if (!plan.ok) {
        await query("ROLLBACK");
        return { error: plan.error, status: plan.status };
      }
      await query("UPDATE products SET name = $1 WHERE id = $2", [plan.name, productId]);
    }
    if (patch.emoji) {
      await query("UPDATE products SET emoji = $1 WHERE id = $2", [patch.emoji, productId]);
    }
    if (patch.defaultBoard && patch.defaultBoard.present) {
      await query("UPDATE products SET default_board_id = $1 WHERE id = $2", [patch.defaultBoard.value, productId]);
    }
    const { rows } = await query("SELECT * FROM products WHERE id = $1", [productId]);
    if (rows.length === 0) {
      await query("ROLLBACK");
      return { error: "Not found", status: 404 };
    }
    await query("COMMIT");
    return { product: rows[0] };
  } catch (err) {
    await query("ROLLBACK").catch(() => {});
    if (isSlugConflict(err)) {
      return { error: "Another product in this org already uses that slug. Pick a different name.", status: 409 };
    }
    throw err;
  }
}

const PRODUCT = { kind: "product", scope: "in this org" };

/** The name's slug is another product's in the same org. @param {unknown} err */
function isSlugConflict(err) {
  const e = /** @type {any} */ (err);
  return Boolean(e && e.code === "23505" && typeof e.constraint === "string" && e.constraint.includes("slug"));
}
