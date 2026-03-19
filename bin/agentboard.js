#!/usr/bin/env node

"use strict";

// ---------------------------------------------------------------------------
// AgentBoard CLI
// ---------------------------------------------------------------------------
// Modes:
//   Local  – set AGENTBOARD_DB to a path; uses better-sqlite3 directly.
//   Remote – set AGENTBOARD_URL + AGENTBOARD_PASSWORD; uses HTTP fetch.
// ---------------------------------------------------------------------------

const fs = require("fs");
const path = require("path");

// ---- Helpers --------------------------------------------------------------

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function die(msg, code = 1) {
  process.stderr.write(`Error: ${msg}\n`);
  process.exit(code);
}

// ---- Arg parser -----------------------------------------------------------

function parseArgs(argv) {
  const args = argv.slice(2);
  const positional = [];
  const flags = {};
  let i = 0;

  while (i < args.length) {
    const arg = args[i];

    if (arg === "--") {
      positional.push(...args.slice(i + 1));
      break;
    }

    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      // Boolean-style flags
      if (key === "json" || key === "quiet") {
        flags[key] = true;
        i++;
        continue;
      }
      // Key-value flags
      if (i + 1 < args.length && !args[i + 1].startsWith("--")) {
        flags[key] = args[i + 1];
        i += 2;
      } else {
        flags[key] = true;
        i++;
      }
    } else {
      positional.push(arg);
      i++;
    }
  }

  return { positional, flags };
}

// ---- Output formatting ----------------------------------------------------

function formatTable(rows, columns) {
  if (!rows || rows.length === 0) return "(no results)";

  const widths = columns.map((c) => c.label.length);
  const data = rows.map((row) =>
    columns.map((c, ci) => {
      const val = String(row[c.key] ?? "");
      if (val.length > widths[ci]) widths[ci] = val.length;
      return val;
    })
  );

  // Cap column widths at 60 characters for readability
  const maxWidth = 60;
  widths.forEach((w, i) => {
    if (w > maxWidth) widths[i] = maxWidth;
  });

  const header = columns.map((c, i) => c.label.padEnd(widths[i])).join("  ");
  const separator = widths.map((w) => "-".repeat(w)).join("  ");
  const lines = data.map((row) =>
    row.map((val, i) => val.slice(0, widths[i]).padEnd(widths[i])).join("  ")
  );

  return [header, separator, ...lines].join("\n");
}

function output(data, flags, idField = "id") {
  if (flags.json) {
    process.stdout.write(JSON.stringify(data, null, 2) + "\n");
  } else if (flags.quiet) {
    const items = Array.isArray(data) ? data : [data];
    items.forEach((item) => process.stdout.write(String(item[idField]) + "\n"));
  } else if (Array.isArray(data)) {
    if (data.length === 0) {
      process.stdout.write("(no results)\n");
    } else {
      const columns = Object.keys(data[0]).map((k) => ({ key: k, label: k }));
      process.stdout.write(formatTable(data, columns) + "\n");
    }
  } else if (typeof data === "object" && data !== null) {
    const maxKey = Math.max(...Object.keys(data).map((k) => k.length));
    for (const [k, v] of Object.entries(data)) {
      process.stdout.write(`${k.padEnd(maxKey)}  ${v ?? ""}\n`);
    }
  } else {
    process.stdout.write(String(data) + "\n");
  }
}

// ---- Default boards / columns (mirroring db.ts) ---------------------------

const DEFAULT_BOARDS = ["Development", "Marketing", "Sales", "Support"];
const DEFAULT_COLUMNS = [
  { name: "Backlog", color: "#6B7280" },
  { name: "Todo", color: "#3B82F6" },
  { name: "In Progress", color: "#F59E0B" },
  { name: "In Review", color: "#8B5CF6" },
  { name: "Done", color: "#10B981" },
];

// ===========================================================================
// LOCAL (SQLite) backend
// ===========================================================================

function getLocalBackend(dbPath) {
  let Database;
  try {
    Database = require("better-sqlite3");
  } catch {
    die(
      "better-sqlite3 is required for local mode. Install it with: npm install better-sqlite3"
    );
  }

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // Auto-create tables
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

  // ---- helper queries ----

  function resolveOrgId(slugOrName) {
    const row = db
      .prepare("SELECT id FROM organizations WHERE slug = ? OR name = ?")
      .get(slugOrName, slugOrName);
    if (!row) die(`Organization not found: ${slugOrName}`);
    return row.id;
  }

  function resolveProductId(slugOrName) {
    const row = db
      .prepare("SELECT id FROM products WHERE slug = ? OR name = ?")
      .get(slugOrName, slugOrName);
    if (!row) die(`Product not found: ${slugOrName}`);
    return row.id;
  }

  function resolveBoardId(productId, slugOrName) {
    const row = db
      .prepare(
        "SELECT id FROM boards WHERE product_id = ? AND (slug = ? OR name = ?)"
      )
      .get(productId, slugOrName, slugOrName);
    if (!row) die(`Board not found: ${slugOrName}`);
    return row.id;
  }

  function resolveColumnId(boardId, slugOrName) {
    const row = db
      .prepare(
        "SELECT id FROM columns WHERE board_id = ? AND (slug = ? OR name = ?)"
      )
      .get(boardId, slugOrName, slugOrName);
    if (!row) die(`Column not found: ${slugOrName}`);
    return row.id;
  }

  function findDoneColumnForCard(cardId) {
    const card = db.prepare("SELECT column_id FROM cards WHERE id = ?").get(cardId);
    if (!card) die(`Card not found: ${cardId}`);
    const col = db.prepare("SELECT board_id FROM columns WHERE id = ?").get(card.column_id);
    const done = db
      .prepare("SELECT id FROM columns WHERE board_id = ? AND slug = 'done'")
      .get(col.board_id);
    if (!done) die("No 'Done' column found on this board");
    return done.id;
  }

  function createDefaultBoardsForProduct(productId) {
    const insertBoard = db.prepare(
      "INSERT INTO boards (product_id, name, slug, position) VALUES (?, ?, ?, ?)"
    );
    const insertColumn = db.prepare(
      "INSERT INTO columns (board_id, name, slug, position, color) VALUES (?, ?, ?, ?, ?)"
    );
    for (let i = 0; i < DEFAULT_BOARDS.length; i++) {
      const boardName = DEFAULT_BOARDS[i];
      const res = insertBoard.run(productId, boardName, slugify(boardName), i);
      const boardId = res.lastInsertRowid;
      for (let j = 0; j < DEFAULT_COLUMNS.length; j++) {
        const c = DEFAULT_COLUMNS[j];
        insertColumn.run(boardId, c.name, slugify(c.name), j, c.color);
      }
    }
  }

  return {
    // -- orgs --
    orgList() {
      return db
        .prepare("SELECT * FROM organizations ORDER BY position, name")
        .all();
    },
    orgAdd(name) {
      const slug = slugify(name);
      const maxPos = db
        .prepare("SELECT COALESCE(MAX(position), -1) as max FROM organizations")
        .get();
      const res = db
        .prepare(
          "INSERT INTO organizations (name, slug, position) VALUES (?, ?, ?)"
        )
        .run(name, slug, maxPos.max + 1);
      return db
        .prepare("SELECT * FROM organizations WHERE id = ?")
        .get(res.lastInsertRowid);
    },
    orgRemove(slug) {
      const res = db
        .prepare("DELETE FROM organizations WHERE slug = ?")
        .run(slug);
      if (res.changes === 0) die(`Organization not found: ${slug}`);
      return { success: true };
    },

    // -- products --
    productList(orgSlug) {
      if (orgSlug) {
        const orgId = resolveOrgId(orgSlug);
        return db
          .prepare(
            "SELECT p.*, o.slug AS org_slug FROM products p JOIN organizations o ON p.org_id = o.id WHERE p.org_id = ? ORDER BY p.position, p.name"
          )
          .all(orgId);
      }
      return db
        .prepare(
          "SELECT p.*, o.slug AS org_slug FROM products p JOIN organizations o ON p.org_id = o.id ORDER BY p.position, p.name"
        )
        .all();
    },
    productAdd(orgSlug, name, emoji) {
      const orgId = resolveOrgId(orgSlug);
      const slug = slugify(name);
      const maxPos = db
        .prepare(
          "SELECT COALESCE(MAX(position), -1) as max FROM products WHERE org_id = ?"
        )
        .get(orgId);
      const res = db
        .prepare(
          "INSERT INTO products (org_id, name, slug, emoji, position) VALUES (?, ?, ?, ?, ?)"
        )
        .run(orgId, name, slug, emoji || "📦", maxPos.max + 1);
      const productId = res.lastInsertRowid;
      createDefaultBoardsForProduct(productId);
      return db.prepare("SELECT * FROM products WHERE id = ?").get(productId);
    },
    productRemove(slug) {
      const res = db.prepare("DELETE FROM products WHERE slug = ?").run(slug);
      if (res.changes === 0) die(`Product not found: ${slug}`);
      return { success: true };
    },

    // -- tasks (cards) --
    taskAdd(opts) {
      const productId = resolveProductId(opts.product);
      const boardId = resolveBoardId(productId, opts.board);
      // Default column is the first column on the board (Backlog)
      let columnId;
      if (opts.column) {
        columnId = resolveColumnId(boardId, opts.column);
      } else {
        const first = db
          .prepare(
            "SELECT id FROM columns WHERE board_id = ? ORDER BY position LIMIT 1"
          )
          .get(boardId);
        if (!first) die("Board has no columns");
        columnId = first.id;
      }
      const maxPos = db
        .prepare(
          "SELECT COALESCE(MAX(position), -1) as max FROM cards WHERE column_id = ?"
        )
        .get(columnId);
      const res = db
        .prepare(
          `INSERT INTO cards (column_id, title, description, assignee, priority, labels, position)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          columnId,
          opts.title,
          opts.description || "",
          opts.assignee || null,
          opts.priority || "medium",
          opts.label || "",
          maxPos.max + 1
        );
      return db
        .prepare("SELECT * FROM cards WHERE id = ?")
        .get(res.lastInsertRowid);
    },

    taskList(opts) {
      const conditions = [];
      const values = [];
      let query = "SELECT cards.*, columns.slug AS column_slug, columns.name AS column_name FROM cards JOIN columns ON cards.column_id = columns.id";

      if (opts.product && opts.board) {
        const productId = resolveProductId(opts.product);
        const boardId = resolveBoardId(productId, opts.board);
        conditions.push("columns.board_id = ?");
        values.push(boardId);
      }
      if (opts.assignee) {
        conditions.push("cards.assignee = ?");
        values.push(opts.assignee);
      }
      if (opts.priority) {
        conditions.push("cards.priority = ?");
        values.push(opts.priority);
      }
      if (opts.column) {
        conditions.push("columns.slug = ?");
        values.push(opts.column);
      }
      if (conditions.length > 0) {
        query += " WHERE " + conditions.join(" AND ");
      }
      query += " ORDER BY cards.position, cards.id";
      return db.prepare(query).all(...values);
    },

    taskShow(cardId) {
      const card = db.prepare("SELECT * FROM cards WHERE id = ?").get(cardId);
      if (!card) die(`Card not found: ${cardId}`);
      return card;
    },

    taskMove(cardId, columnSlug) {
      const card = db.prepare("SELECT column_id FROM cards WHERE id = ?").get(cardId);
      if (!card) die(`Card not found: ${cardId}`);
      const col = db.prepare("SELECT board_id FROM columns WHERE id = ?").get(card.column_id);
      const targetCol = db
        .prepare(
          "SELECT id FROM columns WHERE board_id = ? AND (slug = ? OR name = ?)"
        )
        .get(col.board_id, columnSlug, columnSlug);
      if (!targetCol) die(`Column not found: ${columnSlug}`);

      const maxPos = db
        .prepare(
          "SELECT COALESCE(MAX(position), -1) as max FROM cards WHERE column_id = ?"
        )
        .get(targetCol.id);
      db.prepare(
        "UPDATE cards SET column_id = ?, position = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
      ).run(targetCol.id, maxPos.max + 1, cardId);
      return db.prepare("SELECT * FROM cards WHERE id = ?").get(cardId);
    },

    taskUpdate(cardId, updates) {
      const existing = db.prepare("SELECT * FROM cards WHERE id = ?").get(cardId);
      if (!existing) die(`Card not found: ${cardId}`);

      const allowed = [
        "title",
        "description",
        "assignee",
        "priority",
        "labels",
      ];
      const sets = [];
      const vals = [];
      for (const f of allowed) {
        if (updates[f] !== undefined) {
          sets.push(`${f} = ?`);
          vals.push(updates[f]);
        }
      }
      if (sets.length === 0) return existing;
      sets.push("updated_at = CURRENT_TIMESTAMP");
      vals.push(cardId);
      db.prepare(`UPDATE cards SET ${sets.join(", ")} WHERE id = ?`).run(
        ...vals
      );
      return db.prepare("SELECT * FROM cards WHERE id = ?").get(cardId);
    },

    taskDone(cardId) {
      const doneColId = findDoneColumnForCard(cardId);
      const maxPos = db
        .prepare(
          "SELECT COALESCE(MAX(position), -1) as max FROM cards WHERE column_id = ?"
        )
        .get(doneColId);
      db.prepare(
        "UPDATE cards SET column_id = ?, position = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
      ).run(doneColId, maxPos.max + 1, cardId);
      return db.prepare("SELECT * FROM cards WHERE id = ?").get(cardId);
    },

    taskRemove(cardId) {
      const res = db.prepare("DELETE FROM cards WHERE id = ?").run(cardId);
      if (res.changes === 0) die(`Card not found: ${cardId}`);
      return { success: true };
    },

    taskLink(cardId, opts) {
      const card = db.prepare("SELECT * FROM cards WHERE id = ?").get(cardId);
      if (!card) die(`Card not found: ${cardId}`);
      const sets = [];
      const vals = [];
      if (opts.issue) {
        sets.push("github_issue_url = ?");
        vals.push(opts.issue);
      }
      if (opts.pr) {
        sets.push("github_pr_url = ?");
        vals.push(opts.pr);
      }
      if (sets.length === 0) die("Provide --issue or --pr URL");
      sets.push("updated_at = CURRENT_TIMESTAMP");
      vals.push(cardId);
      db.prepare(`UPDATE cards SET ${sets.join(", ")} WHERE id = ?`).run(
        ...vals
      );
      return db.prepare("SELECT * FROM cards WHERE id = ?").get(cardId);
    },

    taskAttach(cardId, filePath) {
      const card = db.prepare("SELECT id FROM cards WHERE id = ?").get(cardId);
      if (!card) die(`Card not found: ${cardId}`);

      const resolved = path.resolve(filePath);
      if (!fs.existsSync(resolved)) die(`File not found: ${resolved}`);
      const content = fs.readFileSync(resolved, "utf-8");
      const filename = path.basename(resolved);

      const res = db
        .prepare(
          "INSERT INTO attachments (card_id, filename, content) VALUES (?, ?, ?)"
        )
        .run(cardId, filename, content);
      return db
        .prepare("SELECT * FROM attachments WHERE id = ?")
        .get(res.lastInsertRowid);
    },

    taskAttachments(cardId) {
      const card = db.prepare("SELECT id FROM cards WHERE id = ?").get(cardId);
      if (!card) die(`Card not found: ${cardId}`);
      return db
        .prepare(
          "SELECT id, card_id, filename, created_at FROM attachments WHERE card_id = ? ORDER BY created_at"
        )
        .all(cardId);
    },

    // -- views --
    boardView(opts) {
      const productId = resolveProductId(opts.product);
      const boardId = resolveBoardId(productId, opts.board);
      const cols = db
        .prepare(
          "SELECT * FROM columns WHERE board_id = ? ORDER BY position"
        )
        .all(boardId);
      const result = [];
      for (const col of cols) {
        const cards = db
          .prepare(
            "SELECT * FROM cards WHERE column_id = ? ORDER BY position, id"
          )
          .all(col.id);
        result.push({ column: col.name, column_slug: col.slug, cards });
      }
      return result;
    },

    myTasks(assignee) {
      return db
        .prepare(
          `SELECT cards.*, columns.slug AS column_slug, columns.name AS column_name,
                  boards.name AS board_name, products.name AS product_name
           FROM cards
           JOIN columns ON cards.column_id = columns.id
           JOIN boards ON columns.board_id = boards.id
           JOIN products ON boards.product_id = products.id
           WHERE cards.assignee = ?
           ORDER BY cards.priority DESC, cards.position, cards.id`
        )
        .all(assignee);
    },
  };
}

// ===========================================================================
// REMOTE (HTTP) backend
// ===========================================================================

function getRemoteBackend(baseUrl, password) {
  const base = baseUrl.replace(/\/+$/, "");
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${password}`,
  };

  async function req(method, urlPath, body) {
    const url = `${base}${urlPath}`;
    const opts = { method, headers };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const res = await fetch(url, opts);
    if (!res.ok) {
      let msg;
      try {
        const j = await res.json();
        msg = j.error || JSON.stringify(j);
      } catch {
        msg = await res.text();
      }
      die(`HTTP ${res.status}: ${msg}`);
    }
    const text = await res.text();
    if (!text) return {};
    return JSON.parse(text);
  }

  // helper: look up ids from slugs via the API
  async function resolveOrgId(slugOrName) {
    const orgs = await req("GET", "/api/orgs");
    const org = orgs.find(
      (o) => o.slug === slugOrName || o.name === slugOrName
    );
    if (!org) die(`Organization not found: ${slugOrName}`);
    return org.id;
  }

  async function resolveProductId(slugOrName) {
    const products = await req("GET", "/api/products");
    const p = products.find(
      (x) => x.slug === slugOrName || x.name === slugOrName
    );
    if (!p) die(`Product not found: ${slugOrName}`);
    return p.id;
  }

  async function resolveBoardId(productId, slugOrName) {
    const boards = await req("GET", `/api/boards?product_id=${productId}`);
    const b = boards.find(
      (x) => x.slug === slugOrName || x.name === slugOrName
    );
    if (!b) die(`Board not found: ${slugOrName}`);
    return b.id;
  }

  async function resolveColumnId(boardId, slugOrName) {
    const cols = await req("GET", `/api/columns?board_id=${boardId}`);
    const c = cols.find(
      (x) => x.slug === slugOrName || x.name === slugOrName
    );
    if (!c) die(`Column not found: ${slugOrName}`);
    return c.id;
  }

  async function findFirstColumnId(boardId) {
    const cols = await req("GET", `/api/columns?board_id=${boardId}`);
    if (!cols || cols.length === 0) die("Board has no columns");
    cols.sort((a, b) => a.position - b.position);
    return cols[0].id;
  }

  async function findDoneColumnForCard(cardId) {
    const card = await req("GET", `/api/cards/${cardId}`);
    const cols = await req("GET", `/api/columns?board_id=`);
    // We need the board_id from the card's column — fetch all columns to find it
    const allBoards = await req("GET", "/api/boards");
    let boardId = null;
    for (const board of allBoards) {
      const boardCols = await req(
        "GET",
        `/api/columns?board_id=${board.id}`
      );
      if (boardCols.find((c) => c.id === card.column_id)) {
        boardId = board.id;
        break;
      }
    }
    if (!boardId) die("Could not determine board for card");
    const boardCols = await req("GET", `/api/columns?board_id=${boardId}`);
    const done = boardCols.find((c) => c.slug === "done");
    if (!done) die("No 'Done' column found on this board");
    return done.id;
  }

  return {
    // -- orgs --
    async orgList() {
      return req("GET", "/api/orgs");
    },
    async orgAdd(name) {
      return req("POST", "/api/orgs", { name });
    },
    async orgRemove(slug) {
      const orgId = await resolveOrgId(slug);
      return req("DELETE", `/api/orgs/${orgId}`);
    },

    // -- products --
    async productList(orgSlug) {
      if (orgSlug) {
        const orgId = await resolveOrgId(orgSlug);
        return req("GET", `/api/products?org_id=${orgId}`);
      }
      return req("GET", "/api/products");
    },
    async productAdd(orgSlug, name, emoji) {
      const orgId = await resolveOrgId(orgSlug);
      return req("POST", "/api/products", {
        org_id: orgId,
        name,
        emoji: emoji || "📦",
      });
    },
    async productRemove(slug) {
      const productId = await resolveProductId(slug);
      return req("DELETE", `/api/products/${productId}`);
    },

    // -- tasks --
    async taskAdd(opts) {
      const productId = await resolveProductId(opts.product);
      const boardId = await resolveBoardId(productId, opts.board);
      let columnId;
      if (opts.column) {
        columnId = await resolveColumnId(boardId, opts.column);
      } else {
        columnId = await findFirstColumnId(boardId);
      }
      return req("POST", "/api/cards", {
        column_id: columnId,
        title: opts.title,
        description: opts.description || "",
        assignee: opts.assignee || null,
        priority: opts.priority || "medium",
        labels: opts.label || "",
      });
    },

    async taskList(opts) {
      const params = new URLSearchParams();
      if (opts.product && opts.board) {
        const productId = await resolveProductId(opts.product);
        const boardId = await resolveBoardId(productId, opts.board);
        params.set("board_id", boardId);
      }
      if (opts.assignee) params.set("assignee", opts.assignee);
      if (opts.priority) params.set("priority", opts.priority);
      if (opts.column) {
        // Need to resolve column to column_id if board is known
        if (opts.product && opts.board) {
          const productId = await resolveProductId(opts.product);
          const boardId = await resolveBoardId(productId, opts.board);
          const columnId = await resolveColumnId(boardId, opts.column);
          params.set("column_id", columnId);
        }
      }
      if (opts.label) params.set("label", opts.label);
      return req("GET", `/api/cards?${params.toString()}`);
    },

    async taskShow(cardId) {
      return req("GET", `/api/cards/${cardId}`);
    },

    async taskMove(cardId, columnSlug) {
      // Determine the board from the card, then find the target column
      const card = await req("GET", `/api/cards/${cardId}`);
      const allBoards = await req("GET", "/api/boards");
      let boardId = null;
      for (const board of allBoards) {
        const cols = await req("GET", `/api/columns?board_id=${board.id}`);
        if (cols.find((c) => c.id === card.column_id)) {
          boardId = board.id;
          break;
        }
      }
      if (!boardId) die("Could not determine board for card");
      const columnId = await resolveColumnId(boardId, columnSlug);
      return req("PATCH", `/api/cards/${cardId}/move`, { column_id: columnId });
    },

    async taskUpdate(cardId, updates) {
      return req("PATCH", `/api/cards/${cardId}`, updates);
    },

    async taskDone(cardId) {
      const doneColId = await findDoneColumnForCard(cardId);
      return req("PATCH", `/api/cards/${cardId}/move`, {
        column_id: doneColId,
      });
    },

    async taskRemove(cardId) {
      return req("DELETE", `/api/cards/${cardId}`);
    },

    async taskLink(cardId, opts) {
      const body = {};
      if (opts.issue) body.github_issue_url = opts.issue;
      if (opts.pr) body.github_pr_url = opts.pr;
      if (Object.keys(body).length === 0) die("Provide --issue or --pr URL");
      return req("PATCH", `/api/cards/${cardId}`, body);
    },

    async taskAttach(cardId, filePath) {
      const resolved = path.resolve(filePath);
      if (!fs.existsSync(resolved)) die(`File not found: ${resolved}`);
      const content = fs.readFileSync(resolved, "utf-8");
      const filename = path.basename(resolved);
      return req("POST", `/api/cards/${cardId}/attachments`, {
        filename,
        content,
      });
    },

    async taskAttachments(cardId) {
      return req("GET", `/api/cards/${cardId}/attachments`);
    },

    // -- views --
    async boardView(opts) {
      const productId = await resolveProductId(opts.product);
      const boardId = await resolveBoardId(productId, opts.board);
      const cols = await req("GET", `/api/columns?board_id=${boardId}`);
      cols.sort((a, b) => a.position - b.position);
      const result = [];
      for (const col of cols) {
        const cards = await req(
          "GET",
          `/api/cards?board_id=${boardId}&column_id=${col.id}`
        );
        result.push({ column: col.name, column_slug: col.slug, cards });
      }
      return result;
    },

    async myTasks(assignee) {
      return req("GET", `/api/cards?assignee=${encodeURIComponent(assignee)}`);
    },
  };
}

// ===========================================================================
// Command dispatch
// ===========================================================================

function printUsage() {
  const usage = `AgentBoard CLI

Usage: agentboard <command> [options]

Organizations:
  org list                            List all organizations
  org add <name>                      Create an organization
  org remove <slug>                   Delete an organization

Products:
  product list [--org <slug>]         List products
  product add --org <slug> <name> [--emoji <e>]  Create a product
  product remove <slug>               Delete a product

Tasks (Cards):
  task add --product <slug> --board <slug> <title> [options]
    --assignee <name>    --priority <low|medium|high|urgent>
    --label <a,b>        --description <text>  --column <slug>

  task list --product <slug> --board <slug> [filters]
    --assignee <name>  --priority <p>  --column <slug>

  task show <card-id>                 Show card details
  task move <card-id> --column <slug> Move card to column
  task update <card-id> [fields]      Update card fields
  task done <card-id>                 Move card to Done
  task remove <card-id>               Delete a card

  task link <card-id> --issue <url>   Link GitHub issue
  task link <card-id> --pr <url>      Link GitHub PR

  task attach <card-id> --file <path> Attach a file
  task attachments <card-id>          List attachments

Views:
  board --product <slug> --board <slug>   Show board overview
  my-tasks --assignee <name>              Show tasks for assignee

Output:
  --json     JSON output
  --quiet    Minimal output (IDs only)

Environment:
  AGENTBOARD_DB        Path to SQLite database (local mode)
  AGENTBOARD_URL       Server URL (remote mode)
  AGENTBOARD_PASSWORD  Auth password (remote mode)
`;
  process.stdout.write(usage);
}

async function main() {
  const { positional, flags } = parseArgs(process.argv);

  if (positional.length === 0 || flags.help || positional[0] === "help") {
    printUsage();
    process.exit(0);
  }

  // Determine backend
  const dbPath = process.env.AGENTBOARD_DB;
  const remoteUrl = process.env.AGENTBOARD_URL;
  const remotePassword = process.env.AGENTBOARD_PASSWORD;

  let backend;
  if (dbPath) {
    backend = getLocalBackend(dbPath);
  } else if (remoteUrl && remotePassword) {
    backend = getRemoteBackend(remoteUrl, remotePassword);
  } else {
    die(
      "Set AGENTBOARD_DB for local mode, or AGENTBOARD_URL + AGENTBOARD_PASSWORD for remote mode."
    );
  }

  const cmd = positional[0];
  const sub = positional[1];

  try {
    // ---- org ----
    if (cmd === "org") {
      if (sub === "list") {
        const data = await backend.orgList();
        output(data, flags);
      } else if (sub === "add") {
        const name = positional[2];
        if (!name) die("Usage: agentboard org add <name>");
        const data = await backend.orgAdd(name);
        output(data, flags);
      } else if (sub === "remove") {
        const slug = positional[2];
        if (!slug) die("Usage: agentboard org remove <slug>");
        const data = await backend.orgRemove(slug);
        output(data, flags);
      } else {
        die(`Unknown org command: ${sub}. Use: list, add, remove`);
      }
    }

    // ---- product ----
    else if (cmd === "product") {
      if (sub === "list") {
        const data = await backend.productList(flags.org);
        output(data, flags);
      } else if (sub === "add") {
        if (!flags.org) die("--org is required");
        const name = positional[2];
        if (!name) die("Usage: agentboard product add --org <slug> <name>");
        const data = await backend.productAdd(flags.org, name, flags.emoji);
        output(data, flags);
      } else if (sub === "remove") {
        const slug = positional[2];
        if (!slug) die("Usage: agentboard product remove <slug>");
        const data = await backend.productRemove(slug);
        output(data, flags);
      } else {
        die(`Unknown product command: ${sub}. Use: list, add, remove`);
      }
    }

    // ---- task ----
    else if (cmd === "task") {
      if (sub === "add") {
        if (!flags.product) die("--product is required");
        if (!flags.board) die("--board is required");
        const title = positional[2];
        if (!title) die("Usage: agentboard task add --product <s> --board <s> <title>");
        const data = await backend.taskAdd({
          product: flags.product,
          board: flags.board,
          title,
          assignee: flags.assignee,
          priority: flags.priority,
          label: flags.label,
          description: flags.description,
          column: flags.column,
        });
        output(data, flags);
      } else if (sub === "list") {
        if (!flags.product || !flags.board) {
          die("--product and --board are required");
        }
        const data = await backend.taskList({
          product: flags.product,
          board: flags.board,
          assignee: flags.assignee,
          priority: flags.priority,
          column: flags.column,
          label: flags.label,
        });
        output(data, flags);
      } else if (sub === "show") {
        const id = positional[2];
        if (!id) die("Usage: agentboard task show <card-id>");
        const data = await backend.taskShow(id);
        output(data, flags);
      } else if (sub === "move") {
        const id = positional[2];
        if (!id) die("Usage: agentboard task move <card-id> --column <slug>");
        if (!flags.column) die("--column is required");
        const data = await backend.taskMove(id, flags.column);
        output(data, flags);
      } else if (sub === "update") {
        const id = positional[2];
        if (!id) die("Usage: agentboard task update <card-id> [--field value]");
        const updates = {};
        if (flags.title) updates.title = flags.title;
        if (flags.description) updates.description = flags.description;
        if (flags.assignee) updates.assignee = flags.assignee;
        if (flags.priority) updates.priority = flags.priority;
        if (flags.label !== undefined) updates.labels = flags.label;
        const data = await backend.taskUpdate(id, updates);
        output(data, flags);
      } else if (sub === "done") {
        const id = positional[2];
        if (!id) die("Usage: agentboard task done <card-id>");
        const data = await backend.taskDone(id);
        output(data, flags);
      } else if (sub === "remove") {
        const id = positional[2];
        if (!id) die("Usage: agentboard task remove <card-id>");
        const data = await backend.taskRemove(id);
        output(data, flags);
      } else if (sub === "link") {
        const id = positional[2];
        if (!id) die("Usage: agentboard task link <card-id> --issue <url> or --pr <url>");
        const data = await backend.taskLink(id, {
          issue: flags.issue,
          pr: flags.pr,
        });
        output(data, flags);
      } else if (sub === "attach") {
        const id = positional[2];
        if (!id || !flags.file) {
          die("Usage: agentboard task attach <card-id> --file <path>");
        }
        const data = await backend.taskAttach(id, flags.file);
        output(data, flags);
      } else if (sub === "attachments") {
        const id = positional[2];
        if (!id) die("Usage: agentboard task attachments <card-id>");
        const data = await backend.taskAttachments(id);
        output(data, flags);
      } else {
        die(
          `Unknown task command: ${sub}. Use: add, list, show, move, update, done, remove, link, attach, attachments`
        );
      }
    }

    // ---- board view ----
    else if (cmd === "board") {
      if (!flags.product || !flags.board) {
        die("--product and --board are required");
      }
      const data = await backend.boardView({
        product: flags.product,
        board: flags.board,
      });
      if (flags.json) {
        process.stdout.write(JSON.stringify(data, null, 2) + "\n");
      } else if (flags.quiet) {
        for (const col of data) {
          for (const card of col.cards) {
            process.stdout.write(String(card.id) + "\n");
          }
        }
      } else {
        for (const col of data) {
          process.stdout.write(
            `\n=== ${col.column} (${col.cards.length}) ===\n`
          );
          if (col.cards.length === 0) {
            process.stdout.write("  (empty)\n");
          } else {
            const columns = [
              { key: "id", label: "id" },
              { key: "title", label: "title" },
              { key: "assignee", label: "assignee" },
              { key: "priority", label: "priority" },
              { key: "labels", label: "labels" },
            ];
            process.stdout.write(
              formatTable(col.cards, columns)
                .split("\n")
                .map((l) => "  " + l)
                .join("\n") + "\n"
            );
          }
        }
      }
    }

    // ---- my-tasks ----
    else if (cmd === "my-tasks") {
      if (!flags.assignee) die("--assignee is required");
      const data = await backend.myTasks(flags.assignee);
      output(data, flags);
    }

    // ---- unknown ----
    else {
      die(`Unknown command: ${cmd}. Run 'agentboard help' for usage.`);
    }
  } catch (err) {
    if (err.code === "SQLITE_CONSTRAINT_UNIQUE" || (err.message && err.message.includes("UNIQUE"))) {
      die("Already exists (duplicate entry).");
    }
    throw err;
  }
}

main().catch((err) => {
  process.stderr.write(`${err.message || err}\n`);
  process.exit(1);
});
