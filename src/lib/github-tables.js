"use strict";

/**
 * Tables for the GitHub App (card 1000). CommonJS so `scripts/setup-db.js`
 * can share it with `src/lib/db.ts`, the same way the other migrations do.
 *
 * github_installations: which team an installation of the App belongs to. One
 * team per installation, so a webhook can only ever touch that team's cards.
 * Binding goes to the team, the tenancy unit that owns Settings, rather than
 * to one organization: a GitHub org's PRs often close cards in several
 * AgentBoard orgs of the same team.
 *
 * github_deliveries: X-GitHub-Delivery ids already handled, so a redelivery
 * does nothing. Written in the same transaction as the moves it caused. Rows
 * older than 30 days are pruned as new ones arrive; GitHub only lets you
 * redeliver recent deliveries, so older ids can't come back.
 *
 * Must run after TENANCY_MIGRATION, which creates `teams`.
 */
const GITHUB_APP_MIGRATION = `
CREATE TABLE IF NOT EXISTS github_installations (
  installation_id BIGINT PRIMARY KEY,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  account_login TEXT,
  created_by INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS github_installations_team_idx ON github_installations (team_id);
CREATE TABLE IF NOT EXISTS github_deliveries (
  delivery_id TEXT PRIMARY KEY,
  event TEXT NOT NULL,
  installation_id BIGINT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS github_deliveries_received_idx ON github_deliveries (received_at);
`;

module.exports = { GITHUB_APP_MIGRATION };
