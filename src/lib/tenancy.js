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
 * slug, settings and preference keys, product keys.
 *
 * CommonJS so `scripts/setup-db.js` can share it with `src/lib/db.ts`.
 */

/** The single team a self-hosted install resolves to. */
const DEFAULT_TEAM_SLUG = "default";
const DEFAULT_TEAM_NAME = "Default";

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

  -- Settings and preferences were keyed by key alone. Only a single-column
  -- key is replaced, so a table that already has a wider one (the hosted
  -- edition keys preferences by user too) is left alone.
  FOREACH t IN ARRAY ARRAY['settings', 'user_preferences'] LOOP
    SELECT conname, array_length(conkey, 1) INTO pk_name, pk_cols
      FROM pg_constraint WHERE conrelid = t::regclass AND contype = 'p';
    IF pk_cols = 1 THEN
      EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', t, pk_name);
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I PRIMARY KEY (team_id, key)', t, t || '_pkey');
    END IF;
  END LOOP;
END
$migration$;
`;

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

module.exports = {
  DEFAULT_TEAM_SLUG,
  ROOT_TABLES,
  TENANCY_MIGRATION,
  ensureDefaultTeam,
};
