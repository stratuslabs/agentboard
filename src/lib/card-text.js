// A card's free-text fields must arrive as text. An older CLI sent
// `description: true` when a description began with "--", and the API stored
// the word "true" in place of the description without an error (card 22).
// Every card write checks these fields, so no client can do that again.
//
// Plain JavaScript with JSDoc types so `node --test` can run it without a
// build step.

/** Text fields a card write may carry. Only the title can't be cleared. */
export const CARD_TEXT_FIELDS = ["title", "description", "labels", "assignee"];

/** @param {unknown} value */
function kind(value) {
  if (value === null) return "null";
  return Array.isArray(value) ? "array" : typeof value;
}

/**
 * Check the text fields of a card create or update body. Absent fields are
 * fine; whether one is required is the route's call.
 *
 * @param {unknown} body
 * @returns {string | null} an error message, or null when the body is fine
 */
export function checkCardText(body) {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return "Request body must be a JSON object";
  }
  const fields = /** @type {Record<string, unknown>} */ (body);
  for (const field of CARD_TEXT_FIELDS) {
    const value = fields[field];
    if (value === undefined || typeof value === "string") continue;
    if (value === null && field !== "title") continue;
    let msg = `${field} must be a string, got ${kind(value)}`;
    if (typeof value === "boolean") {
      msg += `. agentboard CLI 0.9.0 and older send this when the text starts with "--"; update to 0.9.1 or later, which keeps that text`;
    }
    return msg;
  }
  return null;
}
