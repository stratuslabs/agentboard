// A product's default board is where agents land when they don't name a board
// (no --board, no AGENTBOARD_BOARD). It is a stored choice, never "the first
// board": reordering boards must not silently redirect every agent's cards.
//
// Plain JavaScript with JSDoc types so `node --test` can run it on the Node
// version CI uses, without a build step.

/**
 * @typedef {{ present: false }
 *   | { present: true, value: number | null }
 *   | { present: true, error: string }} DefaultBoardInput
 */

/**
 * Read `default_board_id` from a PATCH body: absent leaves it alone, null
 * clears it, a positive integer sets it. Anything else is an error.
 * @param {unknown} value
 * @returns {DefaultBoardInput}
 */
export function parseDefaultBoardId(value) {
  if (value === undefined) return { present: false };
  if (value === null) return { present: true, value: null };
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return { present: true, value };
  }
  return { present: true, error: "default_board_id must be a board id or null" };
}
