import { sql } from "@vercel/postgres";

let initialized = false;

export async function initDb() {
  if (initialized) return;
  await ensureTables();
  initialized = true;
}

export async function ensureTables() {
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
  // Migration: add assignee_id to cards if not present
  try {
    await sql`ALTER TABLE cards ADD COLUMN IF NOT EXISTS assignee_id INTEGER REFERENCES members(id) ON DELETE SET NULL`;
  } catch {
    // Column may already exist
  }
  // Migration: add due_date to cards if not present
  try {
    await sql`ALTER TABLE cards ADD COLUMN IF NOT EXISTS due_date DATE`;
  } catch {
    // Column may already exist
  }
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
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

const FALLBACK_BOARDS = ["Development", "Marketing", "Sales", "Support"];
const FALLBACK_COLUMNS = [
  { name: "Backlog", color: "#6B7280" },
  { name: "Todo", color: "#3B82F6" },
  { name: "In Progress", color: "#F59E0B" },
  { name: "In Review", color: "#8B5CF6" },
  { name: "Done", color: "#10B981" },
];

export async function createDefaultBoards(productId: number) {
  // Read default boards from settings
  const { rows: boardSettings } = await sql`SELECT value FROM settings WHERE key = 'default_boards'`;
  const boardNames: string[] = boardSettings.length > 0 ? JSON.parse(boardSettings[0].value) : FALLBACK_BOARDS;

  // Read default columns from settings
  const { rows: colSettings } = await sql`SELECT value FROM settings WHERE key = 'default_columns'`;
  const columns: { name: string; color: string }[] = colSettings.length > 0 ? JSON.parse(colSettings[0].value) : FALLBACK_COLUMNS;

  for (let i = 0; i < boardNames.length; i++) {
    const boardName = boardNames[i];
    const boardSlug = slugify(boardName);
    const { rows } = await sql`
      INSERT INTO boards (product_id, name, slug, position)
      VALUES (${productId}, ${boardName}, ${boardSlug}, ${i})
      RETURNING id
    `;
    const boardId = rows[0].id;

    for (let j = 0; j < columns.length; j++) {
      const col = columns[j];
      const colSlug = slugify(col.name);
      await sql`
        INSERT INTO columns (board_id, name, slug, position, color)
        VALUES (${boardId}, ${col.name}, ${colSlug}, ${j}, ${col.color})
      `;
    }
  }
}
