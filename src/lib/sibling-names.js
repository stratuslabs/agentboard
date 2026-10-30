// Plain JavaScript with JSDoc types so `node --test` can import it.
//
// Renaming an org, product or board keeps its slug (see slug.js), so the
// slug's unique index can't stop two siblings ending up with the same name:
// two requests can each check the siblings, find the name free, and write.
// The check and the write that follows it run in one transaction holding a
// lock for the scope, so a second request in the same scope waits, then reads
// the first one's name and gets the 409.

/** First key of the two-key advisory lock, shared by every scope (card 815). */
export const SIBLING_NAME_LOCK = 815;

/**
 * @typedef {(text: string, values?: unknown[]) => Promise<any>} Query
 * @typedef {"org" | "product" | "board"} SiblingKind what's being named
 */

/**
 * Hold the name lock for one scope until the transaction ends: a team's
 * orgs, an org's products or a product's boards. Take it before reading the
 * siblings, and inside a transaction, or it's released at once.
 *
 * @param {Query} query
 * @param {SiblingKind} kind
 * @param {number | string} parentId the team, org or product
 */
export async function lockSiblingNames(query, kind, parentId) {
  await query("SELECT pg_advisory_xact_lock($1, hashtext($2))", [SIBLING_NAME_LOCK, `${kind}:${parentId}`]);
}

/**
 * Run `fn` in a transaction that holds the name lock for one scope, and
 * commit what it did; roll back if it throws. A refusal `fn` returns (a 409)
 * commits nothing, since it wrote nothing.
 *
 * Needs a connection of its own (see `withClient`), because the pool's query
 * may put each statement on a different one.
 *
 * @template T
 * @param {{ query: (text: string, values?: unknown[]) => Promise<any> }} client
 * @param {SiblingKind} kind
 * @param {number | string} parentId the team, org or product
 * @param {(query: Query) => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withSiblingNames(client, kind, parentId, fn) {
  /** @type {Query} */
  const query = (text, values) => client.query(text, values);
  await query("BEGIN");
  try {
    await lockSiblingNames(query, kind, parentId);
    const out = await fn(query);
    await query("COMMIT");
    return out;
  } catch (err) {
    await query("ROLLBACK").catch(() => {});
    throw err;
  }
}
