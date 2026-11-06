// A card's due date must be a date, or null for none. The API used to hand
// any due_date string straight to Postgres, so a value it couldn't read
// (`agentboard task update <id> --due null` sent the text "null") failed the
// write with an HTTP 500 (AB-114). Every card write now checks the value
// first and answers a bad one with a 400 that names it.
//
// Postgres still decides which strings are dates, through the `parse`
// callback, so every value that was accepted before is accepted now.
//
// Plain JavaScript with JSDoc types so `node --test` can run it without a
// build step.

/**
 * Whether a Postgres error from the cast means the value isn't a date. The
 * cast reads only this one value, so any SQLSTATE in class 22 (data
 * exception) is the value's fault: 22007 for "null" or "soon", 22008 for
 * "2026-02-30", 22021 for a NUL character in the text. Anything else (a
 * dropped connection, 08xxx or 57xxx) is the server's problem and is thrown.
 *
 * @param {unknown} err
 */
function notADate(err) {
  const code = /** @type {{ code?: unknown }} */ (err)?.code;
  return typeof code === "string" && code.startsWith("22");
}

/** @param {unknown} value */
function kind(value) {
  return Array.isArray(value) ? "array" : typeof value;
}

/** The value as the message quotes it, cut short so a huge one stays readable. */
function quoted(value) {
  const max = 40;
  return JSON.stringify(value.length > max ? `${value.slice(0, max)}…` : value);
}

/**
 * Check body.due_date for a card create or update. Absent leaves the date
 * alone and null clears it. An empty string is read as null, which card
 * creation already did, and is rewritten to null in the body.
 *
 * @param {Record<string, unknown>} body the request body, already an object
 * @param {(value: string) => Promise<unknown>} parse casts the value to a
 *   date in the database (`SELECT $1::date`), throwing what Postgres throws
 * @returns {Promise<string | null>} an error message, or null when it's fine
 */
export async function checkDueDate(body, parse) {
  const value = body.due_date;
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    return `due_date must be a date string like "2026-11-01", or null to clear it; got ${kind(value)}`;
  }
  if (value === "") {
    body.due_date = null;
    return null;
  }
  try {
    await parse(value);
  } catch (err) {
    if (notADate(err)) {
      return `due_date ${quoted(value)} is not a date. Use YYYY-MM-DD, like 2026-11-01, or null to clear it`;
    }
    throw err;
  }
  return null;
}
