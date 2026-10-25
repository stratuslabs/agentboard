"use strict";

/**
 * One agent per name per team, case-insensitively.
 *
 * Agents register themselves, often from a fresh container every session, so
 * registering again has to land on the row that already exists. Without a
 * unique index two first requests at the same moment both pass a
 * look-then-insert check and both insert, and from then on the agent's work is
 * split across two members.
 *
 * Agents only. Two people on a team may genuinely share a display name, and
 * constraining humans too would either merge two colleagues into one profile or
 * refuse the second Alex.
 *
 * An install from before this index may already hold duplicates. They are
 * renamed, never deleted or merged: a duplicate may carry card assignments, and
 * deleting it would silently move somebody's work. The oldest keeps its name;
 * each later one becomes `name (id)`, or `name (id-1)` and so on when that is
 * taken too, so the index always builds. A migration that could fail here would
 * fail every startup.
 *
 * The index name matches the hosted edition's, so a database that already has
 * it finds nothing to do. Under an advisory lock, so a second instance starting
 * at the same time waits and then finds nothing to do. Must run after
 * TENANCY_MIGRATION, which gives members its team_id.
 *
 * CommonJS so `scripts/setup-db.js` can share it with `src/lib/db.ts`.
 */
const AGENT_NAME_MIGRATION = `
DO $migration$
DECLARE
  dup RECORD;
  candidate TEXT;
  suffix INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(710710);

  IF EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = current_schema() AND indexname = 'members_team_agent_name_key'
  ) THEN
    RETURN;
  END IF;

  LOOP
    SELECT m.id, m.team_id, m.name INTO dup
      FROM members m
     WHERE m.type = 'agent'
       AND EXISTS (
         SELECT 1 FROM members other
          WHERE other.team_id = m.team_id
            AND other.type = 'agent'
            AND LOWER(other.name) = LOWER(m.name)
            AND other.id < m.id
       )
     ORDER BY m.id
     LIMIT 1;
    EXIT WHEN NOT FOUND;

    suffix := 0;
    LOOP
      candidate := dup.name || ' (' || dup.id ||
        CASE WHEN suffix = 0 THEN '' ELSE '-' || suffix END || ')';
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM members taken
         WHERE taken.team_id = dup.team_id
           AND taken.type = 'agent'
           AND LOWER(taken.name) = LOWER(candidate)
      );
      suffix := suffix + 1;
    END LOOP;

    UPDATE members SET name = candidate WHERE id = dup.id;
  END LOOP;

  CREATE UNIQUE INDEX members_team_agent_name_key
    ON members (team_id, LOWER(name))
    WHERE type = 'agent';
END
$migration$;
`;

module.exports = { AGENT_NAME_MIGRATION };
