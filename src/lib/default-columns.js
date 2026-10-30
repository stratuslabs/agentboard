"use strict";

/**
 * The columns a new board starts with, unless the `default_columns` setting
 * says otherwise. Every status the CLI documents (`backlog`, `todo`, `doing`,
 * `blocked`, `in-review`, `done`) has a column here, so `agentboard status
 * <id> blocked` works on a fresh board. Blocked is how an agent asks a human
 * for help, so it is the worst status to be missing.
 *
 * CommonJS so scripts/setup-db.js and scripts/seed.js can require it; the app
 * and the tests import it. This is the only copy of the list.
 *
 * @typedef {{ name: string, color: string }} ColumnDef
 */

/** @type {ColumnDef[]} */
const DEFAULT_COLUMNS = [
  { name: "Backlog", color: "#6B7280" },
  { name: "Todo", color: "#3B82F6" },
  { name: "In Progress", color: "#F59E0B" },
  { name: "Blocked", color: "#EF4444" },
  { name: "In Review", color: "#8B5CF6" },
  { name: "Done", color: "#10B981" },
];

/**
 * The default before Blocked was added. Installs created then have exactly
 * this stored in the `default_columns` setting.
 * @type {ColumnDef[]}
 */
const LEGACY_DEFAULT_COLUMNS = DEFAULT_COLUMNS.filter((c) => c.name !== "Blocked");

/** @param {unknown} list */
function isLegacyDefault(list) {
  return (
    Array.isArray(list) &&
    list.length === LEGACY_DEFAULT_COLUMNS.length &&
    list.every(
      (c, i) =>
        c !== null &&
        typeof c === "object" &&
        Object.keys(c).length === 2 &&
        c.name === LEGACY_DEFAULT_COLUMNS[i].name &&
        c.color === LEGACY_DEFAULT_COLUMNS[i].color,
    )
  );
}

/**
 * Given the stored `default_columns` value, the value to replace it with, or
 * null to leave it alone. Only the untouched old default is upgraded; a list
 * someone edited (renamed, recolored, reordered, added or removed a column)
 * is theirs and stays as it is.
 * @param {string | null | undefined} stored
 * @returns {string | null}
 */
function upgradeDefaultColumnsSetting(stored) {
  if (typeof stored !== "string") return null;
  let parsed;
  try {
    parsed = JSON.parse(stored);
  } catch {
    return null;
  }
  return isLegacyDefault(parsed) ? JSON.stringify(DEFAULT_COLUMNS) : null;
}

/**
 * The columns a new board starts with, from the stored `default_columns`
 * value. New products' boards and boards added to an existing product both
 * use this, so they can't drift apart. A value that can't be read (not JSON,
 * not a list, or entries with no name) gives the built-in list rather than an
 * error. A saved empty list is kept: it's what someone chose in Settings.
 * Entries without a color get the Backlog gray.
 * @param {string | null | undefined} stored
 * @returns {ColumnDef[]}
 */
function columnsFromSetting(stored) {
  if (typeof stored !== "string") return DEFAULT_COLUMNS;
  let parsed;
  try {
    parsed = JSON.parse(stored);
  } catch {
    return DEFAULT_COLUMNS;
  }
  if (!Array.isArray(parsed)) return DEFAULT_COLUMNS;
  /** @type {ColumnDef[]} */
  const columns = [];
  for (const c of parsed) {
    if (c === null || typeof c !== "object" || typeof c.name !== "string" || !c.name.trim()) continue;
    columns.push({ name: c.name, color: typeof c.color === "string" && c.color ? c.color : DEFAULT_COLUMNS[0].color });
  }
  return parsed.length > 0 && columns.length === 0 ? DEFAULT_COLUMNS : columns;
}

/**
 * Stores the default list for a team on a fresh install, and upgrades a team
 * still on the untouched old default. The update compares against the value
 * it read, so an edit saved in between is never overwritten. Shared by
 * `ensureTables()` in src/lib/db.ts and scripts/setup-db.js (through
 * ensureTeamDefaults in tenancy.js) so the two cannot drift.
 * @param {(text: string, values?: unknown[]) => Promise<{ rows: any[] }>} query
 * @param {number} teamId
 */
async function ensureDefaultColumnsSetting(query, teamId) {
  await query(
    `INSERT INTO settings (team_id, key, value) VALUES ($1, 'default_columns', $2)
     ON CONFLICT DO NOTHING`,
    [teamId, JSON.stringify(DEFAULT_COLUMNS)]
  );
  const { rows } = await query(
    "SELECT value FROM settings WHERE team_id = $1 AND key = 'default_columns'",
    [teamId]
  );
  const stored = rows[0] ? rows[0].value : null;
  const upgraded = upgradeDefaultColumnsSetting(stored);
  if (upgraded !== null) {
    await query(
      "UPDATE settings SET value = $1 WHERE team_id = $2 AND key = 'default_columns' AND value = $3",
      [upgraded, teamId, stored]
    );
  }
}

module.exports = {
  DEFAULT_COLUMNS,
  LEGACY_DEFAULT_COLUMNS,
  upgradeDefaultColumnsSetting,
  columnsFromSetting,
  ensureDefaultColumnsSetting,
};
