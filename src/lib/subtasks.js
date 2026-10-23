// Sub-tasks: a checklist on a card, each item a one-line title and a done
// flag. The API validates every write with these rules, and the app and the
// CLI show progress the same way.
//
// Plain JavaScript with JSDoc types so `node --test` can run it on the Node
// version CI uses, without a build step.

/** Longest sub-task title, in characters. A sub-task is a line, not a page. */
export const MAX_SUBTASK_TITLE = 500;

/**
 * @typedef {{ id: number, card_id: number, title: string, done: boolean,
 *   position: number, created_at: string, updated_at: string }} Subtask
 */

/**
 * @template T
 * @typedef {{ ok: true, value: T } | { ok: false, error: string }} Result
 */

/** @param {unknown} body */
function isObject(body) {
  return typeof body === "object" && body !== null && !Array.isArray(body);
}

/**
 * @param {unknown} raw
 * @returns {Result<string>}
 */
function parseTitle(raw) {
  if (typeof raw !== "string") return { ok: false, error: "title is required and must be a string" };
  const title = raw.replace(/\s*[\r\n]+\s*/g, " ").trim();
  if (!title) return { ok: false, error: "title must not be empty" };
  if (title.length > MAX_SUBTASK_TITLE) {
    return { ok: false, error: `title must be at most ${MAX_SUBTASK_TITLE} characters` };
  }
  return { ok: true, value: title };
}

/**
 * @param {unknown} raw
 * @returns {Result<boolean>}
 */
function parseDone(raw) {
  if (typeof raw !== "boolean") return { ok: false, error: "done must be true or false" };
  return { ok: true, value: raw };
}

/**
 * A new sub-task from a request body: `{ title, done? }`.
 * @param {unknown} body
 * @returns {Result<{ title: string, done: boolean }>}
 */
export function parseSubtaskCreate(body) {
  if (!isObject(body)) return { ok: false, error: "body must be a JSON object with a title" };
  const b = /** @type {Record<string, unknown>} */ (body);
  const title = parseTitle(b.title);
  if (!title.ok) return title;
  let done = false;
  if (b.done !== undefined) {
    const d = parseDone(b.done);
    if (!d.ok) return d;
    done = d.value;
  }
  return { ok: true, value: { title: title.value, done } };
}

const UPDATE_FIELDS = new Set(["title", "done"]);

/**
 * A change to a sub-task: `{ title?, done? }`, at least one. Any other field
 * is an error, so a typo doesn't read as a successful no-op.
 * @param {unknown} body
 * @returns {Result<{ title?: string, done?: boolean }>}
 */
export function parseSubtaskUpdate(body) {
  if (!isObject(body)) return { ok: false, error: "body must be a JSON object" };
  const b = /** @type {Record<string, unknown>} */ (body);
  const unknown = Object.keys(b).filter((k) => !UPDATE_FIELDS.has(k));
  if (unknown.length > 0) {
    return { ok: false, error: `unknown field(s): ${unknown.join(", ")}. Accepted: title, done` };
  }
  /** @type {{ title?: string, done?: boolean }} */
  const value = {};
  if (b.title !== undefined) {
    const t = parseTitle(b.title);
    if (!t.ok) return t;
    value.title = t.value;
  }
  if (b.done !== undefined) {
    const d = parseDone(b.done);
    if (!d.ok) return d;
    value.done = d.value;
  }
  if (Object.keys(value).length === 0) return { ok: false, error: "provide title or done" };
  return { ok: true, value };
}

/**
 * "2/5" for a card with sub-tasks, or null for one without. Counts may arrive
 * as strings: node-postgres returns COUNT() as text.
 * @param {number | string | null | undefined} total
 * @param {number | string | null | undefined} done
 * @returns {string | null}
 */
export function subtaskProgress(total, done) {
  const t = Number(total) || 0;
  if (t <= 0) return null;
  return `${Number(done) || 0}/${t}`;
}
