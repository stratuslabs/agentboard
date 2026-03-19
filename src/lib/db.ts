import Database from "better-sqlite3";
import path from "path";

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;

  const dbPath =
    process.env.AGENTBOARD_DB || path.join(process.cwd(), "agentboard.db");
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // Auto-create tables if they don't exist
  db.exec(`
    CREATE TABLE IF NOT EXISTS organizations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      slug TEXT NOT NULL UNIQUE,
      position INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      emoji TEXT DEFAULT '📦',
      position INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(org_id, slug)
    );

    CREATE TABLE IF NOT EXISTS boards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      position INTEGER DEFAULT 0,
      UNIQUE(product_id, slug)
    );

    CREATE TABLE IF NOT EXISTS columns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      board_id INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      position INTEGER DEFAULT 0,
      color TEXT DEFAULT '#6B7280',
      UNIQUE(board_id, slug)
    );

    CREATE TABLE IF NOT EXISTS cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      column_id INTEGER NOT NULL REFERENCES columns(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      assignee TEXT,
      priority TEXT DEFAULT 'medium' CHECK(priority IN ('low','medium','high','urgent')),
      labels TEXT DEFAULT '',
      github_issue_url TEXT,
      github_pr_url TEXT,
      position INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS attachments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  return db;
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

const DEFAULT_BOARDS = ["Development", "Marketing", "Sales", "Support"];
const DEFAULT_COLUMNS = [
  { name: "Backlog", color: "#6B7280" },
  { name: "Todo", color: "#3B82F6" },
  { name: "In Progress", color: "#F59E0B" },
  { name: "In Review", color: "#8B5CF6" },
  { name: "Done", color: "#10B981" },
];

export function createDefaultBoards(productId: number) {
  const db = getDb();
  const insertBoard = db.prepare(
    "INSERT INTO boards (product_id, name, slug, position) VALUES (?, ?, ?, ?)"
  );
  const insertColumn = db.prepare(
    "INSERT INTO columns (board_id, name, slug, position, color) VALUES (?, ?, ?, ?, ?)"
  );

  for (let i = 0; i < DEFAULT_BOARDS.length; i++) {
    const boardName = DEFAULT_BOARDS[i];
    const result = insertBoard.run(productId, boardName, slugify(boardName), i);
    const boardId = result.lastInsertRowid as number;

    for (let j = 0; j < DEFAULT_COLUMNS.length; j++) {
      const col = DEFAULT_COLUMNS[j];
      insertColumn.run(boardId, col.name, slugify(col.name), j, col.color);
    }
  }
}
