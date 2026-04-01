#!/usr/bin/env node

"use strict";

// ---------------------------------------------------------------------------
// AgentBoard CLI
// ---------------------------------------------------------------------------
// Remote-only — set AGENTBOARD_URL (+ AGENTBOARD_PASSWORD if auth enabled).
// For local development, point AGENTBOARD_URL to http://localhost:3000.
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
      if (
        key === "json" ||
        key === "quiet" ||
        key === "include-done" ||
        key === "help"
      ) {
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

// ---- Status aliases -------------------------------------------------------

const STATUS_ALIASES = {
  backlog: "backlog",
  todo: "todo",
  doing: "in-progress",
  "in-progress": "in-progress",
  wip: "in-progress",
  review: "in-review",
  "in-review": "in-review",
  done: "done",
  blocked: "blocked",
};

// ===========================================================================
// HTTP request helper
// ===========================================================================

function makeReq(baseUrl, password, agentName) {
  const base = baseUrl.replace(/\/+$/, "");

  async function req(method, urlPath, body) {
    const url = `${base}${urlPath}`;
    const headers = { "Content-Type": "application/json" };
    if (password) headers.Authorization = `Bearer ${password}`;
    if (agentName) headers["X-Agent-Name"] = agentName;

    const opts = { method, headers, redirect: "manual" };
    if (body !== undefined) opts.body = JSON.stringify(body);

    let res = await fetch(url, opts);

    // Follow redirects manually to preserve auth headers
    let redirects = 0;
    while (
      (res.status === 301 || res.status === 302 || res.status === 307 || res.status === 308) &&
      redirects < 5
    ) {
      const location = res.headers.get("location");
      if (!location) break;
      const nextUrl = location.startsWith("http") ? location : `${base}${location}`;
      const redirectOpts = { method, headers, redirect: "manual" };
      if (body !== undefined) {
        redirectOpts.body = JSON.stringify(body);
      }
      res = await fetch(nextUrl, redirectOpts);
      redirects++;
    }

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

  return req;
}

// ===========================================================================
// Resolution helpers
// ===========================================================================

function makeResolvers(req) {
  async function resolveOrgId(slugOrName) {
    const orgs = await req("GET", "/api/orgs");
    const org = orgs.find((o) => o.slug === slugOrName || o.name === slugOrName);
    if (!org) die(`Organization not found: ${slugOrName}`);
    return org.id;
  }

  async function resolveProductId(slugOrName) {
    const products = await req("GET", "/api/products");
    const p = products.find((x) => x.slug === slugOrName || x.name === slugOrName);
    if (!p) die(`Product not found: ${slugOrName}`);
    return p.id;
  }

  async function resolveBoardId(productId, slugOrName) {
    const boards = await req("GET", `/api/boards?product_id=${productId}`);
    const b = boards.find((x) => x.slug === slugOrName || x.name === slugOrName);
    if (!b) die(`Board not found: ${slugOrName}`);
    return b.id;
  }

  async function resolveColumnId(boardId, slugOrName) {
    const cols = await req("GET", `/api/columns?board_id=${boardId}`);
    const c = cols.find((x) => x.slug === slugOrName || x.name === slugOrName);
    if (!c) die(`Column not found: ${slugOrName}`);
    return c.id;
  }

  async function resolveProductAndBoard(productSlug, boardSlug) {
    const productId = await resolveProductId(productSlug);
    const boardId = await resolveBoardId(productId, boardSlug);
    return { productId, boardId };
  }

  async function findFirstColumnId(boardId) {
    const cols = await req("GET", `/api/columns?board_id=${boardId}`);
    if (!cols || cols.length === 0) die("Board has no columns");
    cols.sort((a, b) => a.position - b.position);
    return cols[0].id;
  }

  async function findBoardIdForCard(cardId) {
    const cols = await req("GET", `/api/columns/by-card/${cardId}`);
    if (!cols || cols.length === 0) die("Could not determine board for card");
    return cols[0].board_id;
  }

  async function resolveMemberId(name) {
    const members = await req("GET", "/api/members");
    const m = members.find(
      (x) => x.name === name || String(x.id) === String(name)
    );
    if (!m) die(`Member not found: ${name}`);
    return m.id;
  }

  return {
    resolveOrgId,
    resolveProductId,
    resolveBoardId,
    resolveColumnId,
    resolveProductAndBoard,
    findFirstColumnId,
    findBoardIdForCard,
    resolveMemberId,
  };
}

// ===========================================================================
// Command dispatch
// ===========================================================================

function printUsage() {
  const usage = `AgentBoard CLI

Usage: agentboard <command> [options]

Simple Commands (use AGENTBOARD_PRODUCT / AGENTBOARD_BOARD env vars):
  list                                 List tasks on current board
    --column <col>  --priority <p>  --label <l>  --assignee <name>  --include-done
  new <title>                          Create a task
    --priority <p>  --assignee <name>  --label <l>  --description <text>
    --column <col>  --due <date>
  status <id> <status>                 Move card (backlog|todo|doing|done|blocked|in-review)
  show <id>                            Show card details
  rename <id> <title>                  Rename a card
  notes <id>                           View description
    --set <text>  --append <text>
  attention <id> on|off                Set priority to urgent/medium
  my-tasks                             Tasks assigned to AGENTBOARD_AGENT_NAME
  today                                Tasks due today
  past-due                             Overdue tasks

Management Commands:
  org list|add|remove|rename|reorder
  product list|add|remove|rename|move|reorder
  board list|add|remove|rename|reorder|view
  column list|add|remove|rename
  member list|add|remove|update
  task add|list|show|move|update|done|remove|link|attach|attachments
  settings [--key <k> --value <v>]
  preferences [--key <k> --value <v>]
  attachment remove <id>

Output:
  --json     JSON output
  --quiet    IDs only

Environment:
  AGENTBOARD_URL         Server URL (required)
  AGENTBOARD_PASSWORD    Auth password (if enabled)
  AGENTBOARD_AGENT_NAME  Agent name (auto-registers, used for my-tasks)
  AGENTBOARD_PRODUCT     Default product slug for simple commands
  AGENTBOARD_BOARD       Default board slug (default: development)
`;
  process.stdout.write(usage);
}

async function main() {
  const { positional, flags } = parseArgs(process.argv);

  if (positional.length === 0 || flags.help || positional[0] === "help") {
    printUsage();
    process.exit(0);
  }

  const remoteUrl = process.env.AGENTBOARD_URL;
  const remotePassword = process.env.AGENTBOARD_PASSWORD || "";
  const agentName = process.env.AGENTBOARD_AGENT_NAME || "";
  const envProduct = flags.product || process.env.AGENTBOARD_PRODUCT || "";
  const envBoard = flags.board || process.env.AGENTBOARD_BOARD || "development";

  if (!remoteUrl) {
    die(
      "Set AGENTBOARD_URL to the server URL (e.g. https://your-instance.vercel.app). Set AGENTBOARD_PASSWORD if auth is enabled."
    );
  }

  const req = makeReq(remoteUrl, remotePassword, agentName);
  const resolve = makeResolvers(req);

  // Helper to require product+board env vars for simple commands
  function requireScope() {
    if (!envProduct) die("Set AGENTBOARD_PRODUCT env var or pass --product <slug>");
    return { product: envProduct, board: envBoard };
  }

  const cmd = positional[0];
  const sub = positional[1];

  try {
    // ================================================================
    // TIER 1: Simple agent commands
    // ================================================================

    // ---- list ----
    if (cmd === "list") {
      const scope = requireScope();
      const { boardId } = await resolve.resolveProductAndBoard(scope.product, scope.board);
      const params = new URLSearchParams({ board_id: boardId });
      if (flags.column) {
        const colSlug = STATUS_ALIASES[flags.column] || flags.column;
        const columnId = await resolve.resolveColumnId(boardId, colSlug);
        params.set("column_id", columnId);
      }
      if (flags.priority) params.set("priority", flags.priority);
      if (flags.label) params.set("label", flags.label);
      if (flags.assignee) params.set("assignee", flags.assignee);

      let cards = await req("GET", `/api/cards?${params.toString()}`);

      // Filter out done unless --include-done
      if (!flags["include-done"]) {
        // Get columns to find done column
        const cols = await req("GET", `/api/columns?board_id=${boardId}`);
        const doneCol = cols.find((c) => c.slug === "done");
        if (doneCol) {
          cards = cards.filter((c) => c.column_id !== doneCol.id);
        }
      }

      output(cards, flags);
    }

    // ---- new ----
    else if (cmd === "new") {
      const scope = requireScope();
      const title = positional[1];
      if (!title) die("Usage: agentboard new <title>");
      const { boardId } = await resolve.resolveProductAndBoard(scope.product, scope.board);

      let columnId;
      if (flags.column) {
        const colSlug = STATUS_ALIASES[flags.column] || flags.column;
        columnId = await resolve.resolveColumnId(boardId, colSlug);
      } else {
        columnId = await resolve.findFirstColumnId(boardId);
      }

      const body = {
        column_id: columnId,
        title,
        description: flags.description || "",
        priority: flags.priority || "medium",
        labels: flags.label || "",
      };
      if (flags.assignee) body.assignee = flags.assignee;
      if (flags.due) body.due_date = flags.due;

      const data = await req("POST", "/api/cards", body);
      output(data, flags);
    }

    // ---- status ----
    else if (cmd === "status") {
      const cardId = positional[1];
      const statusName = positional[2];
      if (!cardId || !statusName) die("Usage: agentboard status <id> <status>");

      const colSlug = STATUS_ALIASES[statusName];
      if (!colSlug) {
        die(
          `Unknown status: ${statusName}. Use: backlog, todo, doing, in-progress, in-review, done, blocked`
        );
      }

      // Get columns for the card's board
      const cols = await req("GET", `/api/columns/by-card/${cardId}`);
      if (!cols || cols.length === 0) die("Could not determine board for card");

      const targetCol = cols.find((c) => c.slug === colSlug);
      if (!targetCol) die(`Column '${colSlug}' not found on this board`);

      const data = await req("PATCH", `/api/cards/${cardId}/move`, {
        column_id: targetCol.id,
      });
      output(data, flags);
    }

    // ---- show ----
    else if (cmd === "show") {
      const cardId = positional[1];
      if (!cardId) die("Usage: agentboard show <id>");
      const data = await req("GET", `/api/cards/${cardId}`);
      output(data, flags);
    }

    // ---- rename ----
    else if (cmd === "rename") {
      const cardId = positional[1];
      const newTitle = positional[2];
      if (!cardId || !newTitle) die("Usage: agentboard rename <id> <title>");
      const data = await req("PATCH", `/api/cards/${cardId}`, { title: newTitle });
      output(data, flags);
    }

    // ---- notes ----
    else if (cmd === "notes") {
      const cardId = positional[1];
      if (!cardId) die("Usage: agentboard notes <id>");

      if (flags.set !== undefined) {
        const data = await req("PATCH", `/api/cards/${cardId}`, {
          description: String(flags.set),
        });
        output(data, flags);
      } else if (flags.append !== undefined) {
        const card = await req("GET", `/api/cards/${cardId}`);
        const current = card.description || "";
        const sep = current ? "\n" : "";
        const data = await req("PATCH", `/api/cards/${cardId}`, {
          description: current + sep + String(flags.append),
        });
        output(data, flags);
      } else {
        const card = await req("GET", `/api/cards/${cardId}`);
        if (flags.json) {
          process.stdout.write(JSON.stringify({ description: card.description }, null, 2) + "\n");
        } else {
          process.stdout.write((card.description || "(no notes)") + "\n");
        }
      }
    }

    // ---- attention ----
    else if (cmd === "attention") {
      const cardId = positional[1];
      const toggle = positional[2];
      if (!cardId || (toggle !== "on" && toggle !== "off")) {
        die("Usage: agentboard attention <id> on|off");
      }
      const priority = toggle === "on" ? "urgent" : "medium";
      const data = await req("PATCH", `/api/cards/${cardId}`, { priority });
      output(data, flags);
    }

    // ---- my-tasks ----
    else if (cmd === "my-tasks") {
      const assignee = flags.assignee || agentName;
      if (!assignee) die("Set AGENTBOARD_AGENT_NAME or pass --assignee <name>");

      // Resolve member id (optional — member may not exist yet for legacy cards)
      const members = await req("GET", "/api/members");
      const member = members.find(
        (m) => m.name === assignee || String(m.id) === String(assignee)
      );

      // Fetch from views endpoint (assignee_id based) if member exists
      let cards = [];
      if (member) {
        cards = await req(
          "GET",
          `/api/cards/views?view=assigned&member_id=${member.id}`
        );
      }

      // Also fetch legacy text-assignee cards and merge (avoids missing pre-migration cards)
      const legacyCards = await req(
        "GET",
        `/api/cards?assignee=${encodeURIComponent(assignee)}`
      );
      const existingIds = new Set(cards.map((c) => c.id));
      for (const card of legacyCards) {
        if (!existingIds.has(card.id)) cards.push(card);
      }

      output(cards, flags);
    }

    // ---- today ----
    else if (cmd === "today") {
      const data = await req("GET", "/api/cards/views?view=today");
      output(data, flags);
    }

    // ---- past-due ----
    else if (cmd === "past-due") {
      const assignee = flags.assignee || agentName;
      if (!assignee) die("Set AGENTBOARD_AGENT_NAME or pass --assignee <name>");

      const members = await req("GET", "/api/members");
      const member = members.find(
        (m) => m.name === assignee || String(m.id) === String(assignee)
      );
      if (!member) die(`Member not found: ${assignee}`);

      const data = await req(
        "GET",
        `/api/cards/views?view=past-due&member_id=${member.id}`
      );
      output(data, flags);
    }

    // ================================================================
    // TIER 2: Management commands
    // ================================================================

    // ---- org ----
    else if (cmd === "org") {
      if (sub === "list") {
        output(await req("GET", "/api/orgs"), flags);
      } else if (sub === "add") {
        const name = positional[2];
        if (!name) die("Usage: agentboard org add <name>");
        output(await req("POST", "/api/orgs", { name }), flags);
      } else if (sub === "remove") {
        const slug = positional[2];
        if (!slug) die("Usage: agentboard org remove <slug>");
        const orgId = await resolve.resolveOrgId(slug);
        output(await req("DELETE", `/api/orgs/${orgId}`), flags);
      } else if (sub === "rename") {
        const slug = positional[2];
        const newName = flags.name || positional[3];
        if (!slug || !newName) die("Usage: agentboard org rename <slug> --name <new-name>");
        const orgId = await resolve.resolveOrgId(slug);
        output(await req("PATCH", `/api/orgs/${orgId}`, { name: newName }), flags);
      } else if (sub === "reorder") {
        if (!flags.ids) die("Usage: agentboard org reorder --ids <1,2,3>");
        const ids = String(flags.ids).split(",").map((s) => parseInt(s.trim(), 10));
        output(await req("PATCH", "/api/orgs/reorder", { ids }), flags);
      } else {
        die(`Unknown org command: ${sub}. Use: list, add, remove, rename, reorder`);
      }
    }

    // ---- product ----
    else if (cmd === "product") {
      if (sub === "list") {
        const params = new URLSearchParams();
        if (flags.org) {
          const orgId = await resolve.resolveOrgId(flags.org);
          params.set("org_id", orgId);
        }
        output(await req("GET", `/api/products?${params.toString()}`), flags);
      } else if (sub === "add") {
        if (!flags.org) die("--org is required");
        const name = positional[2];
        if (!name) die("Usage: agentboard product add --org <slug> <name>");
        const orgId = await resolve.resolveOrgId(flags.org);
        output(
          await req("POST", "/api/products", {
            org_id: orgId,
            name,
            emoji: flags.emoji || "📦",
          }),
          flags
        );
      } else if (sub === "remove") {
        const slug = positional[2];
        if (!slug) die("Usage: agentboard product remove <slug>");
        const productId = await resolve.resolveProductId(slug);
        output(await req("DELETE", `/api/products/${productId}`), flags);
      } else if (sub === "rename") {
        const slug = positional[2];
        if (!slug) die("Usage: agentboard product rename <slug> [--name <n>] [--emoji <e>]");
        const productId = await resolve.resolveProductId(slug);
        const body = {};
        if (flags.name) body.name = flags.name;
        if (flags.emoji) body.emoji = flags.emoji;
        if (Object.keys(body).length === 0) die("Provide --name or --emoji");
        output(await req("PATCH", `/api/products/${productId}`, body), flags);
      } else if (sub === "move") {
        const slug = positional[2];
        if (!slug || !flags.org) die("Usage: agentboard product move <slug> --org <org-slug>");
        const productId = await resolve.resolveProductId(slug);
        const orgId = await resolve.resolveOrgId(flags.org);
        output(
          await req("PATCH", "/api/products/move", {
            product_id: productId,
            org_id: orgId,
          }),
          flags
        );
      } else if (sub === "reorder") {
        if (!flags.ids) die("Usage: agentboard product reorder --ids <1,2,3>");
        const ids = String(flags.ids).split(",").map((s) => parseInt(s.trim(), 10));
        output(await req("PATCH", "/api/products/reorder", { ids }), flags);
      } else {
        die(`Unknown product command: ${sub}. Use: list, add, remove, rename, move, reorder`);
      }
    }

    // ---- board ----
    else if (cmd === "board") {
      if (sub === "list") {
        const productSlug = flags.product || envProduct;
        if (!productSlug) die("--product is required (or set AGENTBOARD_PRODUCT)");
        const productId = await resolve.resolveProductId(productSlug);
        output(await req("GET", `/api/boards?product_id=${productId}`), flags);
      } else if (sub === "add") {
        const productSlug = flags.product || envProduct;
        if (!productSlug) die("--product is required");
        const name = positional[2];
        if (!name) die("Usage: agentboard board add <name> --product <slug>");
        const productId = await resolve.resolveProductId(productSlug);
        output(await req("POST", "/api/boards", { product_id: productId, name }), flags);
      } else if (sub === "remove") {
        const boardId = positional[2];
        if (!boardId) die("Usage: agentboard board remove <board-id>");
        output(await req("DELETE", `/api/boards/${boardId}`), flags);
      } else if (sub === "rename") {
        const boardId = positional[2];
        const newName = flags.name || positional[3];
        if (!boardId || !newName) die("Usage: agentboard board rename <board-id> --name <new-name>");
        output(await req("PATCH", `/api/boards/${boardId}`, { name: newName }), flags);
      } else if (sub === "reorder") {
        if (!flags.ids) die("Usage: agentboard board reorder --ids <1,2,3>");
        const ids = String(flags.ids).split(",").map((s) => parseInt(s.trim(), 10));
        output(await req("PATCH", "/api/boards/reorder", { ids }), flags);
      } else if (sub === "view") {
        const productSlug = flags.product || envProduct;
        const boardSlug = flags.board || envBoard;
        if (!productSlug) die("--product is required (or set AGENTBOARD_PRODUCT)");
        const { boardId } = await resolve.resolveProductAndBoard(productSlug, boardSlug);
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
        if (flags.json) {
          process.stdout.write(JSON.stringify(result, null, 2) + "\n");
        } else if (flags.quiet) {
          for (const col of result) {
            for (const card of col.cards) {
              process.stdout.write(String(card.id) + "\n");
            }
          }
        } else {
          for (const col of result) {
            process.stdout.write(
              `\n=== ${col.column} (${col.cards.length}) ===\n`
            );
            if (col.cards.length === 0) {
              process.stdout.write("  (empty)\n");
            } else {
              const columns = [
                { key: "id", label: "id" },
                { key: "title", label: "title" },
                { key: "assignee_name", label: "assignee" },
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
      } else {
        die(
          `Unknown board command: ${sub}. Use: list, add, remove, rename, reorder, view`
        );
      }
    }

    // ---- column ----
    else if (cmd === "column") {
      if (sub === "list") {
        let boardId;
        if (flags["board-id"]) {
          boardId = flags["board-id"];
        } else {
          const productSlug = flags.product || envProduct;
          const boardSlug = flags.board || envBoard;
          if (!productSlug) die("--product is required (or set AGENTBOARD_PRODUCT)");
          ({ boardId } = await resolve.resolveProductAndBoard(productSlug, boardSlug));
        }
        output(await req("GET", `/api/columns?board_id=${boardId}`), flags);
      } else if (sub === "add") {
        let boardId;
        if (flags["board-id"]) {
          boardId = flags["board-id"];
        } else {
          const productSlug = flags.product || envProduct;
          const boardSlug = flags.board || envBoard;
          if (!productSlug) die("--product is required (or set AGENTBOARD_PRODUCT)");
          ({ boardId } = await resolve.resolveProductAndBoard(productSlug, boardSlug));
        }
        const name = positional[2];
        if (!name) die("Usage: agentboard column add <name>");
        const body = { board_id: parseInt(boardId, 10), name };
        if (flags.color) body.color = flags.color;
        output(await req("POST", "/api/columns", body), flags);
      } else if (sub === "remove") {
        const colId = positional[2];
        if (!colId) die("Usage: agentboard column remove <column-id>");
        output(await req("DELETE", `/api/columns/${colId}`), flags);
      } else if (sub === "rename") {
        const colId = positional[2];
        if (!colId) die("Usage: agentboard column rename <column-id> [--name <n>] [--color <hex>]");
        const body = {};
        if (flags.name) body.name = flags.name;
        if (flags.color) body.color = flags.color;
        if (flags.position) body.position = parseInt(flags.position, 10);
        if (Object.keys(body).length === 0) die("Provide --name, --color, or --position");
        output(await req("PATCH", `/api/columns/${colId}`, body), flags);
      } else {
        die(`Unknown column command: ${sub}. Use: list, add, remove, rename`);
      }
    }

    // ---- member ----
    else if (cmd === "member") {
      if (sub === "list") {
        output(await req("GET", "/api/members"), flags);
      } else if (sub === "add") {
        const name = positional[2];
        if (!name) die("Usage: agentboard member add <name> [--type agent|human] [--color <hex>]");
        const body = { name };
        if (flags.type) body.type = flags.type;
        if (flags.color) body.color = flags.color;
        if (flags["avatar-url"]) body.avatar_url = flags["avatar-url"];
        output(await req("POST", "/api/members", body), flags);
      } else if (sub === "remove") {
        const id = positional[2];
        if (!id) die("Usage: agentboard member remove <member-id>");
        output(await req("DELETE", `/api/members/${id}`), flags);
      } else if (sub === "update") {
        const id = positional[2];
        if (!id) die("Usage: agentboard member update <member-id> [--name <n>] [--type <t>] [--color <hex>]");
        const body = {};
        if (flags.name) body.name = flags.name;
        if (flags.type) body.type = flags.type;
        if (flags.color) body.color = flags.color;
        if (flags["avatar-url"]) body.avatar_url = flags["avatar-url"];
        if (Object.keys(body).length === 0) die("Provide at least one field to update");
        output(await req("PATCH", `/api/members/${id}`, body), flags);
      } else {
        die(`Unknown member command: ${sub}. Use: list, add, remove, update`);
      }
    }

    // ---- task (verbose / power-user) ----
    else if (cmd === "task") {
      if (sub === "add") {
        const productSlug = flags.product || envProduct;
        const boardSlug = flags.board || envBoard;
        if (!productSlug) die("--product is required (or set AGENTBOARD_PRODUCT)");
        const title = positional[2];
        if (!title) die("Usage: agentboard task add <title> --product <slug> --board <slug>");
        const { boardId } = await resolve.resolveProductAndBoard(productSlug, boardSlug);

        let columnId;
        if (flags.column) {
          const colSlug = STATUS_ALIASES[flags.column] || flags.column;
          columnId = await resolve.resolveColumnId(boardId, colSlug);
        } else {
          columnId = await resolve.findFirstColumnId(boardId);
        }

        const body = {
          column_id: columnId,
          title,
          description: flags.description || "",
          priority: flags.priority || "medium",
          labels: flags.label || "",
        };
        if (flags.assignee) body.assignee = flags.assignee;
        if (flags.due) body.due_date = flags.due;
        output(await req("POST", "/api/cards", body), flags);
      } else if (sub === "list") {
        const productSlug = flags.product || envProduct;
        const boardSlug = flags.board || envBoard;
        if (!productSlug) die("--product is required (or set AGENTBOARD_PRODUCT)");
        const { boardId } = await resolve.resolveProductAndBoard(productSlug, boardSlug);
        const params = new URLSearchParams({ board_id: boardId });
        if (flags.column) {
          const colSlug = STATUS_ALIASES[flags.column] || flags.column;
          const columnId = await resolve.resolveColumnId(boardId, colSlug);
          params.set("column_id", columnId);
        }
        if (flags.assignee) params.set("assignee", flags.assignee);
        if (flags.priority) params.set("priority", flags.priority);
        if (flags.label) params.set("label", flags.label);
        output(await req("GET", `/api/cards?${params.toString()}`), flags);
      } else if (sub === "show") {
        const id = positional[2];
        if (!id) die("Usage: agentboard task show <card-id>");
        output(await req("GET", `/api/cards/${id}`), flags);
      } else if (sub === "move") {
        const id = positional[2];
        if (!id || !flags.column) die("Usage: agentboard task move <card-id> --column <slug>");
        const colSlug = STATUS_ALIASES[flags.column] || flags.column;
        const cols = await req("GET", `/api/columns/by-card/${id}`);
        if (!cols || cols.length === 0) die("Could not determine board for card");
        const targetCol = cols.find((c) => c.slug === colSlug);
        if (!targetCol) die(`Column '${colSlug}' not found on this board`);
        output(
          await req("PATCH", `/api/cards/${id}/move`, { column_id: targetCol.id }),
          flags
        );
      } else if (sub === "update") {
        const id = positional[2];
        if (!id) die("Usage: agentboard task update <card-id> [--field value]");
        const updates = {};
        if (flags.title) updates.title = flags.title;
        if (flags.description) updates.description = flags.description;
        if (flags.assignee) updates.assignee = flags.assignee;
        if (flags.priority) updates.priority = flags.priority;
        if (flags.label !== undefined) updates.labels = flags.label;
        if (flags.due) updates.due_date = flags.due;
        if (flags.issue) updates.github_issue_url = flags.issue;
        if (flags.pr) updates.github_pr_url = flags.pr;
        if (Object.keys(updates).length === 0) die("Provide at least one field to update");
        output(await req("PATCH", `/api/cards/${id}`, updates), flags);
      } else if (sub === "done") {
        const id = positional[2];
        if (!id) die("Usage: agentboard task done <card-id>");
        const cols = await req("GET", `/api/columns/by-card/${id}`);
        if (!cols || cols.length === 0) die("Could not determine board for card");
        const doneCol = cols.find((c) => c.slug === "done");
        if (!doneCol) die("No 'done' column found on this board");
        output(
          await req("PATCH", `/api/cards/${id}/move`, { column_id: doneCol.id }),
          flags
        );
      } else if (sub === "remove") {
        const id = positional[2];
        if (!id) die("Usage: agentboard task remove <card-id>");
        output(await req("DELETE", `/api/cards/${id}`), flags);
      } else if (sub === "link") {
        const id = positional[2];
        if (!id) die("Usage: agentboard task link <card-id> --issue <url> or --pr <url>");
        const body = {};
        if (flags.issue) body.github_issue_url = flags.issue;
        if (flags.pr) body.github_pr_url = flags.pr;
        if (Object.keys(body).length === 0) die("Provide --issue or --pr URL");
        output(await req("PATCH", `/api/cards/${id}`, body), flags);
      } else if (sub === "attach") {
        const id = positional[2];
        if (!id || !flags.file) die("Usage: agentboard task attach <card-id> --file <path>");
        const resolved = path.resolve(flags.file);
        if (!fs.existsSync(resolved)) die(`File not found: ${resolved}`);
        const content = fs.readFileSync(resolved, "utf-8");
        const filename = path.basename(resolved);
        output(
          await req("POST", `/api/cards/${id}/attachments`, { filename, content }),
          flags
        );
      } else if (sub === "attachments") {
        const id = positional[2];
        if (!id) die("Usage: agentboard task attachments <card-id>");
        output(await req("GET", `/api/cards/${id}/attachments`), flags);
      } else if (sub === "reorder") {
        if (!flags.ids) die("Usage: agentboard task reorder --ids <1,2,3>");
        const ids = String(flags.ids).split(",").map((s) => parseInt(s.trim(), 10));
        output(await req("PATCH", "/api/cards/reorder", { ids }), flags);
      } else {
        die(
          `Unknown task command: ${sub}. Use: add, list, show, move, update, done, remove, link, attach, attachments, reorder`
        );
      }
    }

    // ---- settings ----
    else if (cmd === "settings") {
      if (flags.key && flags.value !== undefined) {
        let value = flags.value;
        try {
          value = JSON.parse(value);
        } catch {
          // keep as string
        }
        output(await req("PATCH", "/api/settings", { key: flags.key, value }), flags);
      } else {
        output(await req("GET", "/api/settings"), flags);
      }
    }

    // ---- preferences ----
    else if (cmd === "preferences") {
      if (flags.key && flags.value !== undefined) {
        let value = flags.value;
        try {
          value = JSON.parse(value);
        } catch {
          // keep as string
        }
        output(await req("PATCH", "/api/preferences", { key: flags.key, value }), flags);
      } else {
        output(await req("GET", "/api/preferences"), flags);
      }
    }

    // ---- attachment ----
    else if (cmd === "attachment") {
      if (sub === "remove") {
        const id = positional[2];
        if (!id) die("Usage: agentboard attachment remove <id>");
        output(await req("DELETE", `/api/attachments/${id}`), flags);
      } else {
        die(`Unknown attachment command: ${sub}. Use: remove`);
      }
    }

    // ---- unknown ----
    else {
      die(`Unknown command: ${cmd}. Run 'agentboard help' for usage.`);
    }
  } catch (err) {
    if (
      err.message &&
      (err.message.includes("unique") || err.message.includes("duplicate"))
    ) {
      die("Already exists (duplicate entry).");
    }
    throw err;
  }
}

main().catch((err) => {
  process.stderr.write(`${err.message || err}\n`);
  process.exit(1);
});
