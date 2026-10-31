import { sql, db } from "./sql";
import { DEFAULT_BOARD_MIGRATION } from "./default-board-migration";
import { columnsFromSetting } from "./default-columns";
import { SHADOWED_ORG_SLUGS } from "./org-slug";
import { slugify, uniqueBySlug } from "./slug";
import { planColumnReslug } from "./column-slug";
import { CARD_NUMBER_MIGRATION, ensureProductKeys } from "./card-keys";
import { TENANCY_MIGRATION } from "./tenancy";
import { AGENT_NAME_MIGRATION } from "./agent-names";
import { GITHUB_APP_MIGRATION } from "./github-tables";

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
  // Migration: stamp boards and columns the way cards already are, so a client
  // can ask for everything that changed since a timestamp instead of refetching
  // the whole board every few seconds. `IF NOT EXISTS` is already idempotent,
  // so this needs no guard.
  await sql`ALTER TABLE boards ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()`;
  await sql`ALTER TABLE columns ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()`;
  // Migration: a product's default board is where the CLI lands when no board
  // is named. Products that predate it get their `development` board, once,
  // atomically with adding the column (see default-board-migration.js).
  await db.query(DEFAULT_BOARD_MIGRATION);
  // Migration: an organization slugged `c` or `api` is shadowed by the app's
  // own routes (`/c/<id>`, `/api/...`), so none of its product pages can be
  // reached. Move it to `<slug>-org` (or `<slug>-org-2`, ... if that is taken).
  // Its old URLs never worked, so nothing that worked breaks.
  const { rows: shadowed } = await sql`
    SELECT id, slug FROM organizations WHERE slug = ANY(${[...SHADOWED_ORG_SLUGS]})
  `;
  for (const org of shadowed) {
    for (let n = 1; ; n++) {
      const candidate = n === 1 ? `${org.slug}-org` : `${org.slug}-org-${n}`;
      // Only move it if it still has the shadowed slug: another instance
      // starting up at the same time may already have moved it.
      const { rowCount } = await sql`
        UPDATE organizations SET slug = ${candidate}
        WHERE id = ${org.id} AND slug = ${org.slug}
          AND NOT EXISTS (SELECT 1 FROM organizations WHERE slug = ${candidate})
      `;
      if (rowCount) break;
      const { rows: still } = await sql`
        SELECT 1 FROM organizations WHERE id = ${org.id} AND slug = ${org.slug}
      `;
      if (still.length === 0) break;
    }
  }
  // Migration: renaming a column used to keep its old slug, so a column
  // renamed from "Todo" to "Can't replicate" still answered to
  // `agentboard status <id> todo`. Slugs now follow names on rename; this
  // repairs columns renamed before that. Idempotent: once every slug matches
  // its name, the plan is empty.
  const { rows: allColumns } = await sql`
    SELECT id, board_id, name, slug FROM columns ORDER BY board_id, position, id
  `;
  const columnsByBoard = new Map<number, { id: number; name: string; slug: string }[]>();
  for (const c of allColumns) {
    const list = columnsByBoard.get(c.board_id) ?? [];
    list.push({ id: c.id, name: c.name, slug: c.slug });
    columnsByBoard.set(c.board_id, list);
  }
  for (const [boardId, boardColumns] of columnsByBoard) {
    for (const step of planColumnReslug(boardColumns)) {
      // Guarded the same way as the org move above, in case another instance
      // is starting up at the same time.
      await sql`
        UPDATE columns SET slug = ${step.to}, updated_at = NOW()
        WHERE id = ${step.id} AND slug = ${step.from}
          AND NOT EXISTS (SELECT 1 FROM columns WHERE board_id = ${boardId} AND slug = ${step.to})
      `;
    }
  }
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
  // Migration: tenancy. A teams table and team_id on the root tables, an
  // existing install moved into one default team, uniques per team (see
  // tenancy.js). Before card numbers, whose product keys are per team.
  await db.query(TENANCY_MIGRATION);
  // Migration: one agent per name per team, so an agent registering again
  // lands on its own row (see agent-names.js). Needs members.team_id.
  await db.query(AGENT_NAME_MIGRATION);
  // Migration: human-readable card ids. Products get a key (AB) and a
  // counter, cards a per-product number (AB-142), assigned by a trigger and
  // backfilled for existing cards in one atomic statement (see card-keys.js).
  await db.query(CARD_NUMBER_MIGRATION);
  await ensureProductKeys((text, values) => db.query(text, values));
  await sql`
    CREATE TABLE IF NOT EXISTS attachments (
      id SERIAL PRIMARY KEY,
      card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `;
  // Sub-tasks: a checklist on a card. Every write also bumps the card's
  // updated_at, so board deltas and the realtime stream pick it up.
  await sql`
    CREATE TABLE IF NOT EXISTS subtasks (
      id SERIAL PRIMARY KEY,
      card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      done BOOLEAN NOT NULL DEFAULT FALSE,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS subtasks_card_id_idx ON subtasks (card_id, position, id)`;
  // Card links: any http(s) URL a card points at (a Slack thread, a doc, a
  // design), beside the GitHub issue and PR fields. One row per URL per card,
  // so linking the same URL again updates it instead of adding a duplicate.
  await sql`
    CREATE TABLE IF NOT EXISTS card_links (
      id SERIAL PRIMARY KEY,
      card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
      url TEXT NOT NULL,
      title TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE (card_id, url)
    )
  `;
  // GitHub App (card 1000): installation bindings and handled deliveries
  // (see github-tables.js). Needs teams.
  await db.query(GITHUB_APP_MIGRATION);
  // A team's default settings are written when the team is first resolved
  // (see src/lib/tenant.ts), not here: they belong to a team now.
}

export { slugify };

const FALLBACK_BOARDS = ["Development", "Marketing", "Sales", "Support"];

/**
 * The columns a new board in this team starts with: the Default columns
 * setting, or the built-in list. A saved column that makes the same slug as
 * an earlier one is skipped (Can't, then Cant), rather than failing the
 * insert after the board exists.
 */
export async function teamDefaultColumns(teamId: number) {
  const { rows } = await sql`SELECT value FROM settings WHERE team_id = ${teamId} AND key = 'default_columns'`;
  return uniqueBySlug(columnsFromSetting(rows[0]?.value), (col) => col.name);
}

export async function createDefaultBoards(teamId: number, productId: number) {
  // Read the team's default boards from settings
  const { rows: boardSettings } = await sql`SELECT value FROM settings WHERE team_id = ${teamId} AND key = 'default_boards'`;
  const boardNames: string[] = boardSettings.length > 0 ? JSON.parse(boardSettings[0].value) : FALLBACK_BOARDS;

  const cols = await teamDefaultColumns(teamId);

  // A default that makes the same slug as an earlier one is skipped, rather
  // than failing the insert after the product and some boards exist.
  const boards = uniqueBySlug(boardNames, (name) => name);

  for (let i = 0; i < boards.length; i++) {
    const { item: boardName, slug: boardSlug } = boards[i];
    const { rows } = await sql`
      INSERT INTO boards (product_id, name, slug, position)
      VALUES (${productId}, ${boardName}, ${boardSlug}, ${i})
      RETURNING id
    `;
    const boardId = rows[0].id;
    // A new product starts with its first default board as the agents' default.
    // It is stored, so reordering boards later doesn't move it.
    if (i === 0) {
      await sql`UPDATE products SET default_board_id = ${boardId} WHERE id = ${productId}`;
    }

    for (let j = 0; j < cols.length; j++) {
      const { item: col, slug: colSlug } = cols[j];
      await sql`
        INSERT INTO columns (board_id, name, slug, position, color)
        VALUES (${boardId}, ${col.name}, ${colSlug}, ${j}, ${col.color})
      `;
    }
  }
}
