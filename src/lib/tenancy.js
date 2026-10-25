"use strict";

/**
 * Tenancy: a `team` owns everything on the board. Self-hosted AgentBoard has
 * exactly one team and resolves every request to it, so nothing changes for a
 * self-hosted user. The hosted edition has many and resolves the team from the
 * signed-in user or API key (see src/lib/tenant.ts).
 *
 * The team key lives on the root tables only: organizations, members, settings
 * and user_preferences. Products, boards, columns, cards, card numbers,
 * attachments and sub-tasks reach their team through cascading foreign keys,
 * so they carry no team_id of their own. product_keys is the exception (see
 * card-keys.js): a deleted product's keys stay as tombstones with no product,
 * so they keep their team on the row. This is the same grain the hosted
 * edition's schema already uses, so it can adopt this one without renames.
 *
 * Uniques that used to be per instance are per team: organization name and
 * slug, settings keys, product keys.
 *
 * Preferences are per user within a team, as in the hosted edition. Self-hosted
 * has no accounts, so every request acts as one implicit user, SELF_HOSTED_USER_ID
 * (0), which no hosted users row can be: their ids start at 1.
 *
 * CommonJS so `scripts/setup-db.js` can share it with `src/lib/db.ts`.
 */

/** The single team a self-hosted install resolves to. */
const DEFAULT_TEAM_SLUG = "default";
const DEFAULT_TEAM_NAME = "Default";

/** The one user a self-hosted install has. See tenant.ts. */
const SELF_HOSTED_USER_ID = 0;

/** Tables that hold team_id directly. Everything else inherits it. */
const ROOT_TABLES = ["organizations", "members", "settings", "user_preferences"];

/**
 * Teams table, team_id on the root tables, a backfill to the default team for
 * rows from before tenancy, then NOT NULL and per-team uniques. One statement,
 * so Postgres applies it atomically, under an advisory lock so a second
 * instance starting at the same time waits and then finds nothing to do. Safe
 * on every startup.
 *
 * The default team is only created here when there are rows to backfill. A
 * fresh self-hosted install gets it from ensureDefaultTeam(); the hosted
 * edition, whose teams have owners, never needs it.
 *
 * Must run after the root tables exist and before CARD_NUMBER_MIGRATION, which
 * reads organizations.team_id.
 */
const TENANCY_MIGRATION = `
DO $migration$
DECLARE
  t TEXT;
  v_team INTEGER;
  pk_name TEXT;
  pk_cols INTEGER;
  pk_has_user BOOLEAN;
  n INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(708708);

  CREATE TABLE IF NOT EXISTS teams (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  FOREACH t IN ARRAY ARRAY[${ROOT_TABLES.map((n) => `'${n}'`).join(", ")}] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS team_id INTEGER REFERENCES teams(id) ON DELETE CASCADE', t);
  END LOOP;

  -- Rows from before tenancy all belong to the one team the instance had.
  FOREACH t IN ARRAY ARRAY[${ROOT_TABLES.map((n) => `'${n}'`).join(", ")}] LOOP
    EXECUTE format('SELECT 1 FROM %I WHERE team_id IS NULL LIMIT 1', t);
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n > 0 THEN
      IF v_team IS NULL THEN
        INSERT INTO teams (name, slug) VALUES ('${DEFAULT_TEAM_NAME}', '${DEFAULT_TEAM_SLUG}')
          ON CONFLICT (slug) DO NOTHING;
        SELECT id INTO v_team FROM teams WHERE slug = '${DEFAULT_TEAM_SLUG}';
      END IF;
      EXECUTE format('UPDATE %I SET team_id = $1 WHERE team_id IS NULL', t) USING v_team;
    END IF;
    EXECUTE format('ALTER TABLE %I ALTER COLUMN team_id SET NOT NULL', t);
  END LOOP;

  CREATE INDEX IF NOT EXISTS idx_organizations_team_id ON organizations (team_id);
  CREATE INDEX IF NOT EXISTS idx_members_team_id ON members (team_id);

  -- Organization name and slug: unique per team, no longer per instance.
  ALTER TABLE organizations DROP CONSTRAINT IF EXISTS organizations_name_key;
  ALTER TABLE organizations DROP CONSTRAINT IF EXISTS organizations_slug_key;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'organizations'::regclass AND conname = 'organizations_team_id_slug_key') THEN
    ALTER TABLE organizations ADD CONSTRAINT organizations_team_id_slug_key UNIQUE (team_id, slug);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'organizations'::regclass AND conname = 'organizations_team_id_name_key') THEN
    ALTER TABLE organizations ADD CONSTRAINT organizations_team_id_name_key UNIQUE (team_id, name);
  END IF;

  -- Settings were keyed by key alone; now by team and key.
  SELECT conname, array_length(conkey, 1) INTO pk_name, pk_cols
    FROM pg_constraint WHERE conrelid = 'settings'::regclass AND contype = 'p';
  IF pk_cols = 1 THEN
    EXECUTE format('ALTER TABLE settings DROP CONSTRAINT %I', pk_name);
    ALTER TABLE settings ADD CONSTRAINT settings_pkey PRIMARY KEY (team_id, key);
  END IF;

  -- Preferences: by team, user and key, as the hosted edition already has them
  -- (its table, with user_id in the key, is left exactly as it is). Existing
  -- self-hosted preferences belong to its one implicit user.
  ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS user_id INTEGER NOT NULL DEFAULT ${SELF_HOSTED_USER_ID};
  SELECT c.conname, EXISTS (
      SELECT 1 FROM pg_attribute a
      WHERE a.attrelid = c.conrelid AND a.attname = 'user_id' AND a.attnum = ANY (c.conkey)
    ) INTO pk_name, pk_has_user
    FROM pg_constraint c WHERE c.conrelid = 'user_preferences'::regclass AND c.contype = 'p';
  IF NOT pk_has_user THEN
    EXECUTE format('ALTER TABLE user_preferences DROP CONSTRAINT %I', pk_name);
    ALTER TABLE user_preferences ADD CONSTRAINT user_preferences_pkey PRIMARY KEY (team_id, user_id, key);
  END IF;
END
$migration$;
`;

const { ensureDefaultColumnsSetting } = require("./default-columns");

const DEFAULT_BOARDS = ["Development", "Marketing", "Sales", "Support"];

/**
 * @typedef {(text: string, values?: unknown[]) => Promise<{ rows: any[], rowCount?: number | null }>} Query
 */

/**
 * The self-hosted team's id, creating it on a fresh install. Safe against
 * another instance doing the same.
 * @param {Query} query
 * @returns {Promise<number>}
 */
async function ensureDefaultTeam(query) {
  await query(
    "INSERT INTO teams (name, slug) VALUES ($1, $2) ON CONFLICT (slug) DO NOTHING",
    [DEFAULT_TEAM_NAME, DEFAULT_TEAM_SLUG]
  );
  const { rows } = await query("SELECT id FROM teams WHERE slug = $1", [DEFAULT_TEAM_SLUG]);
  return rows[0].id;
}

/**
 * A team's settings as a fresh install has them: the boards and columns a new
 * product starts with. Never overwrites one the team has changed.
 * @param {Query} query
 * @param {number} teamId
 */
async function ensureTeamDefaults(query, teamId) {
  await query(
    `INSERT INTO settings (team_id, key, value) VALUES ($1, 'default_boards', $2)
     ON CONFLICT DO NOTHING`,
    [teamId, JSON.stringify(DEFAULT_BOARDS)]
  );
  await ensureDefaultColumnsSetting(query, teamId);
}

module.exports = {
  SELF_HOSTED_USER_ID,
  DEFAULT_BOARDS,
  DEFAULT_TEAM_SLUG,
  ROOT_TABLES,
  TENANCY_MIGRATION,
  ensureDefaultTeam,
  ensureTeamDefaults,
};
