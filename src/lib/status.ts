/**
 * Status aliases: the vocabulary agents and humans actually type, mapped to the
 * column slugs a board really has.
 *
 * This map lived only in `cli/agentboard.js`, which was fine while the CLI was
 * the only non-browser client. It is shared now because `GET /api/whoami` has
 * to tell a caller which statuses are valid *before* it makes its first write —
 * an agent connecting over MCP has no env vars, no repo checkout, and no way to
 * learn the vocabulary by reading our source.
 */
export const STATUS_ALIASES: Record<string, string> = {
  backlog: "backlog",
  todo: "todo",
  doing: "in-progress",
  "in-progress": "in-progress",
  wip: "in-progress",
  review: "in-review",
  "in-review": "in-review",
  done: "done",
  blocked: "blocked",
};

/**
 * Resolve a status word to a column slug, or `null` if it is not a known alias.
 *
 * A slug that is already a real column name passes through unchanged, so a
 * board with custom columns stays reachable by its own vocabulary.
 */
export function resolveStatus(input: string): string | null {
  const key = input.trim().toLowerCase();
  return STATUS_ALIASES[key] ?? null;
}

/**
 * The subset of aliases that resolve against a specific board's columns.
 *
 * Reporting the whole table would be a lie for any board that does not have,
 * say, a `blocked` column: the caller would send a status the board cannot
 * accept and get an error it could not have predicted.
 */
export function aliasesForColumns(
  columnSlugs: string[]
): Record<string, string> {
  const available = new Set(columnSlugs);
  const out: Record<string, string> = {};
  for (const [alias, slug] of Object.entries(STATUS_ALIASES)) {
    if (available.has(slug)) out[alias] = slug;
  }
  return out;
}
