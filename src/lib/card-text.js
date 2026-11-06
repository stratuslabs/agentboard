// A card's free-text fields must arrive as text. An older CLI sent
// `description: true` when a description began with "--", and the API stored
// the word "true" in place of the description without an error (card 22).
// Every card write checks these fields, so no client can do that again.
//
// Postgres text can't hold a NUL character (U+0000) either: one that got
// through failed the INSERT or UPDATE with "invalid byte sequence", an HTTP
// 500 (AB-117). Every string a card write stores is checked for one first.
//
// Priority is one of four words, as the cards table's CHECK constraint has
// it. Anything else failed the write the same way (AB-119).
//
// Plain JavaScript with JSDoc types so `node --test` can run it without a
// build step.

/** Text fields a card write may carry. Only the title can't be cleared. */
export const CARD_TEXT_FIELDS = ["title", "description", "labels", "assignee"];

/**
 * Every string field a card write stores. Priority and the GitHub links are
 * not free text, but a NUL in any of them fails the write the same way.
 */
const STORED_STRING_FIELDS = [...CARD_TEXT_FIELDS, "priority", "github_issue_url", "github_pr_url"];

/** The priorities a card can have, the same four as cards_priority_check. */
export const PRIORITIES = ["low", "medium", "high", "urgent"];

/** @param {unknown} value */
function kind(value) {
  if (value === null) return "null";
  return Array.isArray(value) ? "array" : typeof value;
}

/**
 * Check the text fields of a card create or update body. Absent fields are
 * fine; whether one is required is the route's call.
 *
 * Priority, when present, is one of PRIORITIES, or null: on update null
 * clears it, and on create null or an empty string means the default, medium.
 *
 * @param {unknown} body
 * @param {{ create?: boolean }} [options] create: the body makes a new card
 * @returns {string | null} an error message, or null when the body is fine
 */
export function checkCardText(body, { create = false } = {}) {
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
  for (const field of STORED_STRING_FIELDS) {
    const value = fields[field];
    if (typeof value === "string" && value.includes("\u0000")) {
      return `${field} can't contain a NUL character (\\u0000)`;
    }
  }
  const priority = fields.priority;
  if (priority === undefined || priority === null || (create && priority === "")) return null;
  if (typeof priority === "string" && PRIORITIES.includes(priority)) return null;
  return `priority must be low, medium, high or urgent, got ${shown(priority)}`;
}

/**
 * A value for an error message: a string quoted and cut short, anything else
 * by its kind.
 *
 * @param {unknown} value
 */
function shown(value) {
  if (typeof value !== "string") return kind(value);
  return JSON.stringify(value.length > 20 ? `${value.slice(0, 20)}\u2026` : value);
}
