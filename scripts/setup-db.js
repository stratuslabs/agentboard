// Standalone database setup for self-hosting (PostgreSQL).
//
// IMPORTANT: keep this schema in sync with `ensureTables()` in `src/lib/db.ts`,
// which is the runtime source of truth — the app also creates/migrates these
// tables lazily on the first request. This script exists so a fresh deploy can
// be initialized explicitly (e.g. `vercel env pull .env.local && npm run db:setup`).

const { sql, end } = require("../src/lib/sql");

async function setup() {
  await sql`
    CREATE TABLE IF NOT EXISTS organizations (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      slug TEXT NOT NULL UNIQUE,
      position INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      emoji TEXT DEFAULT '📦',
      position INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(org_id, slug)
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS boards (
      id SERIAL PRIMARY KEY,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      position INTEGER DEFAULT 0,
      UNIQUE(product_id, slug)
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS columns (
      id SERIAL PRIMARY KEY,
      board_id INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      position INTEGER DEFAULT 0,
      color TEXT DEFAULT '#6B7280',
      UNIQUE(board_id, slug)
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS cards (
      id SERIAL PRIMARY KEY,
      column_id INTEGER NOT NULL REFERENCES columns(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      assignee TEXT,
      priority TEXT DEFAULT 'medium' CHECK(priority IN ('low','medium','high','urgent')),
      labels TEXT DEFAULT '',
      github_issue_url TEXT,
      github_pr_url TEXT,
      position INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS members (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'human' CHECK(type IN ('human', 'agent')),
      color TEXT DEFAULT '#6B7280',
      avatar_url TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `;
  // Migration: link cards to members (matches src/lib/db.ts)
  await sql`ALTER TABLE cards ADD COLUMN IF NOT EXISTS assignee_id INTEGER REFERENCES members(id) ON DELETE SET NULL`;
  // Migration: due dates on cards
  await sql`ALTER TABLE cards ADD COLUMN IF NOT EXISTS due_date DATE`;
  await sql`
    CREATE TABLE IF NOT EXISTS attachments (
      id SERIAL PRIMARY KEY,
      card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS user_preferences (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `;
  await sql`
    INSERT INTO settings (key, value)
    VALUES ('default_boards', '["Development","Marketing","Sales","Support"]')
    ON CONFLICT DO NOTHING
  `;
  await sql`
    INSERT INTO settings (key, value)
    VALUES ('default_columns', ${JSON.stringify([
      { name: "Backlog", color: "#6B7280" },
      { name: "Todo", color: "#3B82F6" },
      { name: "In Progress", color: "#F59E0B" },
      { name: "In Review", color: "#8B5CF6" },
      { name: "Done", color: "#10B981" },
    ])})
    ON CONFLICT DO NOTHING
  `;

  console.log("Database setup complete (PostgreSQL).");
}

setup()
  .then(() => end())
  .catch(async (err) => {
    console.error("Setup failed:", err.message);
    await end().catch(() => {});
    process.exit(1);
  });
