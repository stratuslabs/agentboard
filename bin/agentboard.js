#!/usr/bin/env node

"use strict";

// ---------------------------------------------------------------------------
// AgentBoard CLI
// ---------------------------------------------------------------------------
// Mode: Remote – set AGENTBOARD_URL (+ AGENTBOARD_PASSWORD if auth enabled).
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

// ===========================================================================
// REMOTE (HTTP) backend
// ===========================================================================

function getRemoteBackend(baseUrl, password) {
  const base = baseUrl.replace(/\/+$/, "");
  const headers = { "Content-Type": "application/json" };
  if (password) {
    headers.Authorization = `Bearer ${password}`;
  }

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
    // We need the board_id from the card's column — fetch all boards to find it
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
  AGENTBOARD_URL       Server URL (e.g. http://localhost:3000)
  AGENTBOARD_PASSWORD  Auth password (if APP_PASSWORD is set)
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

  if (!remoteUrl) {
    die(
      "Set AGENTBOARD_URL to the server URL (e.g. http://localhost:3000). Set AGENTBOARD_PASSWORD if auth is enabled."
    );
  }

  const backend = getRemoteBackend(remoteUrl, remotePassword);

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
    if (err.message && (err.message.includes("unique") || err.message.includes("duplicate"))) {
      die("Already exists (duplicate entry).");
    }
    throw err;
  }
}

main().catch((err) => {
  process.stderr.write(`${err.message || err}\n`);
  process.exit(1);
});
