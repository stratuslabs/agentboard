#!/usr/bin/env node

"use strict";

// ---------------------------------------------------------------------------
// AgentBoard CLI
// ---------------------------------------------------------------------------
// Remote-only — set AGENTBOARD_URL (+ AGENTBOARD_TOKEN if auth enabled).
// For local development, point AGENTBOARD_URL to http://localhost:3000.
// ---------------------------------------------------------------------------

const fs = require("fs");
const path = require("path");

const VERSION = require("./package.json").version;

// ---- Helpers --------------------------------------------------------------

// "slug (Name), ..." so an error shows what actually exists: a board's
// columns, or the orgs and products you can see. A column's slug follows its
// name, so a renamed column no longer answers to its old slug.
function describeNamed(items) {
  return items.map((c) => (c.name && c.name !== c.slug ? `${c.slug} (${c.name})` : c.slug)).join(", ");
}

// First line-ish of a response body, enough to recognise a login page.
function snippet(text, max = 200) {
  const flat = String(text || "").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}...` : flat;
}

function die(msg, code = 1) {
  process.stderr.write(`Error: ${msg}\n`);
  process.exit(code);
}

// ---- Label edits ----------------------------------------------------------

// Labels are stored as one comma-separated string. These split it the same
// way the web app does (trim, drop empties) and compare case-insensitively,
// like the board's label filter.
function splitLabels(value) {
  return String(value ?? "").split(",").map((l) => l.trim()).filter(Boolean);
}

// Read --add-label / --remove-label from parsed flags. Returns null when
// neither is given; dies on usage errors before anything is sent.
function parseLabelEdit(flags) {
  const hasAdd = flags["add-label"] !== undefined;
  const hasRemove = flags["remove-label"] !== undefined;
  if (!hasAdd && !hasRemove) return null;
  if (flags.label !== undefined) {
    die("--label replaces all labels; use it on its own, or use --add-label / --remove-label to change single labels");
  }
  const add = [];
  const remove = [];
  for (const [flag, list] of [["add-label", add], ["remove-label", remove]]) {
    if (flags[flag] === undefined) continue;
    for (const value of flags[flag]) {
      const labels = splitLabels(value);
      if (labels.length === 0) die(`--${flag} needs at least one label`);
      list.push(...labels);
    }
  }
  const removing = new Set(remove.map((l) => l.toLowerCase()));
  const both = add.find((l) => removing.has(l.toLowerCase()));
  if (both !== undefined) die(`'${both}' is in both --add-label and --remove-label`);
  return { add, remove };
}

// Apply an edit to a card's current labels string. Keeps the order and
// spelling of labels the card already has, appends new ones, and reports
// labels that were already there or already absent.
function applyLabelEdit(current, { add, remove }) {
  const before = splitLabels(current);
  const notes = [];
  const removing = new Set(remove.map((l) => l.toLowerCase()));
  const kept = before.filter((l) => !removing.has(l.toLowerCase()));
  const had = new Set(before.map((l) => l.toLowerCase()));
  for (const l of remove) {
    if (!had.has(l.toLowerCase())) notes.push(`Card {id} doesn't have label '${l}'`);
  }
  const seen = new Set(kept.map((l) => l.toLowerCase()));
  for (const l of add) {
    const k = l.toLowerCase();
    if (seen.has(k)) {
      if (had.has(k)) notes.push(`Card {id} already has label '${l}'`);
      continue;
    }
    seen.add(k);
    kept.push(l);
  }
  const changed =
    kept.length !== before.length || kept.some((l, i) => l !== before[i]);
  return { labels: kept.join(","), changed, notes };
}

// ---- Arg parser -----------------------------------------------------------

const BOOLEAN_FLAGS = new Set(["json", "quiet", "include-done", "help", "version"]);

// Flags that always take a value. The next argument is consumed even when it
// starts with "--", so `--description "--dry-run is broken"` keeps its text
// instead of turning it into a flag. `--flag=value` works too.
const VALUE_FLAGS = new Set([
  "product", "board", "board-id", "column", "to-product", "to-board",
  "priority", "assignee", "label", "description", "due", "title",
  "issue", "pr", "url", "file", "ids", "name", "emoji", "org", "type", "color",
  "avatar-url", "position", "set", "append", "key", "value",
  "add-label", "remove-label",
]);

// Value flags that may be given more than once. Their values collect into an
// array, so `--add-label a --add-label b` keeps both instead of the last.
const REPEATABLE_FLAGS = new Set(["add-label", "remove-label"]);

function setValueFlag(flags, key, value) {
  if (REPEATABLE_FLAGS.has(key)) (flags[key] ??= []).push(value);
  else flags[key] = value;
}

// Flags each command accepts, beyond --json/--quiet/--help/--version.
// Anything else is an error: an ignored flag reads as success when the
// command did something other than what was asked.
const COMMAND_FLAGS = {
  list: ["product", "board", "column", "priority", "label", "assignee", "include-done"],
  new: ["product", "board", "column", "priority", "assignee", "label", "description", "due"],
  status: [],
  show: [],
  rename: [],
  notes: ["set", "append"],
  attention: [],
  "my-tasks": ["assignee"],
  today: [],
  "past-due": ["assignee"],
  "org list": [],
  "org add": [],
  "org remove": [],
  "org rename": ["name"],
  "org reorder": ["ids"],
  "product list": ["org"],
  "product add": ["org", "emoji", "key"],
  "product remove": [],
  "product rename": ["name", "emoji", "key"],
  "product move": ["org"],
  "product reorder": ["ids"],
  "board list": ["product"],
  "board add": ["product"],
  "board remove": [],
  "board rename": ["name"],
  "board reorder": ["ids"],
  "board view": ["product", "board"],
  "column list": ["product", "board", "board-id"],
  "column add": ["product", "board", "board-id", "color"],
  "column remove": [],
  "column rename": ["name", "color", "position"],
  "member list": [],
  "member add": ["type", "color", "avatar-url"],
  "member remove": [],
  "member update": ["name", "type", "color", "avatar-url"],
  "task add": ["product", "board", "column", "description", "priority", "label", "assignee", "due"],
  "task list": ["product", "board", "column", "assignee", "priority", "label"],
  "task show": [],
  "task move": ["column", "to-product", "to-board"],
  "task update": ["title", "description", "assignee", "priority", "label", "add-label", "remove-label", "due", "issue", "pr"],
  "task done": [],
  "task remove": [],
  "task link": ["issue", "pr", "url", "title"],
  "task links": [],
  "task unlink": ["url"],
  "task attach": ["file"],
  "task attachments": [],
  "task reorder": ["ids"],
  settings: ["key", "value"],
  preferences: ["key", "value"],
  "attachment remove": [],
  "subtask list": [],
  "subtask add": [],
  "subtask done": [],
  "subtask undo": [],
  "subtask rename": [],
  "subtask remove": [],
};

const GLOBAL_FLAGS = ["json", "quiet", "help", "version"];

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
      const eq = arg.indexOf("=");
      const key = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
      const inline = eq === -1 ? undefined : arg.slice(eq + 1);

      if (BOOLEAN_FLAGS.has(key)) {
        if (inline !== undefined) die(`--${key} does not take a value`);
        flags[key] = true;
        i++;
      } else if (VALUE_FLAGS.has(key)) {
        if (inline !== undefined) {
          setValueFlag(flags, key, inline);
          i++;
        } else if (i + 1 < args.length) {
          const next = args[i + 1];
          // `--description --priority high` is a missing value, not a
          // description that reads "--priority". Taking it as text would
          // silently drop the flag that follows. Text that merely starts
          // with "--" ("--dry-run is broken") is still taken as given.
          const named = /^--([a-z][a-z-]*)$/.exec(next);
          if (named && (BOOLEAN_FLAGS.has(named[1]) || VALUE_FLAGS.has(named[1]))) {
            die(`--${key} needs a value, but the next argument is the flag ${next}. To pass '${next}' as the text, write --${key}=${next}`);
          }
          setValueFlag(flags, key, next);
          i += 2;
        } else {
          die(`--${key} requires a value`);
        }
      } else {
        die(`Unknown flag: --${key}. Run 'agentboard help' for usage.`);
      }
    } else if (/^-[a-zA-Z]/.test(arg)) {
      // No short flags exist; don't let `-q` pass as a positional argument.
      die(`Unknown flag: ${arg}. Short flags aren't supported; use the --long form.`);
    } else {
      positional.push(arg);
      i++;
    }
  }

  return { positional, flags };
}

// Reject flags the command doesn't use. Unknown commands are left for the
// dispatcher to report.
function checkFlags(positional, flags) {
  const [cmd, sub] = positional;
  const key = COMMAND_FLAGS[`${cmd} ${sub}`] ? `${cmd} ${sub}` : cmd;
  const allowed = COMMAND_FLAGS[key];
  if (!allowed) return;
  const unsupported = Object.keys(flags).filter(
    (f) => !allowed.includes(f) && !GLOBAL_FLAGS.includes(f)
  );
  if (unsupported.length > 0) {
    const list = unsupported.map((f) => `--${f}`).join(", ");
    const accepted = allowed.length ? allowed.map((f) => `--${f}`).join(", ") : "none";
    die(`'${key}' does not accept ${list}. Accepted flags: ${accepted}`);
  }
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

// ---- Created cards --------------------------------------------------------

/** The POST /api/cards body for `new` and `task add`, minus the column. */
function newCardFields(title, flags) {
  const fields = {
    title,
    description: flags.description || "",
    priority: flags.priority || "medium",
    labels: flags.label || "",
  };
  if (flags.assignee) fields.assignee = flags.assignee;
  if (flags.due) fields.due_date = flags.due;
  return fields;
}

/**
 * A created card with its product, board and column. Values the server sent
 * win; the CLI's own resolution only fills fields an older server left out.
 */
function withCreatedLocation(card, product, board, column) {
  const pick = (v, fallback) => (v === undefined || v === null ? fallback : v);
  return {
    ...card,
    column_slug: pick(card.column_slug, column.slug),
    column_name: pick(card.column_name, column.name),
    board_id: pick(card.board_id, board.id),
    board_slug: pick(card.board_slug, board.slug),
    board_name: pick(card.board_name, board.name),
    product_id: pick(card.product_id, product.id),
    product_slug: pick(card.product_slug, product.slug),
    product_name: pick(card.product_name, product.name),
  };
}

/** "Created AB-12 on agentboard/development in Todo" */
function createdLine(card) {
  const label = card.key ? card.key : `card ${card.id}`;
  const product = card.product_slug || card.product_name;
  const board = card.board_slug || card.board_name;
  const column = card.column_name || card.column_slug;
  return `Created ${label} on ${product}/${board} in ${column}`;
}

/** --json and --quiet as usual; the text output leads with where it landed. */
function outputCreated(card, flags) {
  if (!flags.json && !flags.quiet) process.stdout.write(createdLine(card) + "\n");
  output(card, flags);
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

// A column the board really has wins over the legacy alias table: once a
// column is named "Doing" its slug is `doing`, and `status <id> doing` must
// reach it rather than being rewritten to `in-progress`.
/**
 * A product's default board, when no board was named:
 * 1. the default the product has set, if that board still exists;
 * 2. the only board, when there is exactly one;
 * 3. on an older server that has no notion of defaults (the field is absent),
 *    the board slugged `development`, which is what the CLI always assumed.
 * Never "the first board": reordering boards would silently move every agent.
 */
function pickDefaultBoard(product, boards) {
  if (!boards || boards.length === 0) return null;
  if (product.default_board_id != null) {
    const set = boards.find((b) => b.id === product.default_board_id);
    if (set) return set;
  }
  if (boards.length === 1) return boards[0];
  if (!("default_board_id" in product)) {
    return boards.find((b) => b.slug === "development") || null;
  }
  return null;
}

function describeBoards(boards) {
  return [...boards]
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map((b) => `${b.slug} (${b.name})`)
    .join(", ");
}

// "Product 'x' not found. Available: a (A), b (B)" for an org, product or
// board that didn't resolve, so a typo doesn't need a second command to fix.
// `items` is described in the order given; `kind` is plural, for the
// nothing-exists case.
function notFound(what, tried, where, items, describe, kind) {
  const head = `${what} '${tried}' not found${where ? ` in ${where}` : ""}.`;
  if (!items || items.length === 0) {
    return `${head} ${where ? "It has" : "You have"} no ${kind} yet.`;
  }
  return `${head} Available: ${describe(items)}`;
}

// A column by slug or name, in this order: an exact slug, an exact name, then
// a slug or name that matches ignoring case, then a legacy alias. A renamed
// Backlog is named "Inbox" but keeps the slug `backlog`, so `inbox` has to
// reach it. When the case-insensitive pass matches more than one column (say
// "Review" and "review"), refuse rather than pick one, and suggest slugs: they
// are unique per board and exact slugs win, whereas one column's exact name
// can be another column's slug.
function findColumn(cols, input) {
  const exact = cols.find((c) => c.slug === input) || cols.find((c) => c.name === input);
  if (exact) return exact;
  const want = String(input).toLowerCase();
  const loose = cols.filter(
    (c) => String(c.slug).toLowerCase() === want || String(c.name ?? "").toLowerCase() === want
  );
  if (loose.length === 1) return loose[0];
  if (loose.length > 1) {
    die(
      `Column '${input}' matches more than one column: ${describeNamed(loose)}. ` +
        `Use one of these slugs: ${loose.map((c) => c.slug).join(", ")}.`
    );
  }
  const alias = Object.hasOwn(STATUS_ALIASES, want) ? STATUS_ALIASES[want] : null;
  return (alias && cols.find((c) => c.slug === alias)) || null;
}

// ===========================================================================
// HTTP request helper
// ===========================================================================

function makeReq(baseUrl, password, agentName) {
  const base = baseUrl.replace(/\/+$/, "");

  async function req(method, urlPath, body) {
    const url = `${base}${urlPath}`;
    const headers = {};
    // Only set Content-Type on requests with a body
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (password) headers.Authorization = `Bearer ${password}`;
    // Only send agent name on POST (card creation) to avoid silent reassignment on updates
    if (agentName && method === "POST") headers["X-Agent-Name"] = agentName;

    const opts = { method, headers, redirect: "manual" };
    if (body !== undefined) opts.body = JSON.stringify(body);

    let res = await send(url, opts);

    // Follow redirects manually so the auth header survives them — but only
    // while we stay on the origin the user configured. Forwarding the Bearer
    // token to whatever host a redirect names would hand the password to
    // anyone able to inject a Location response.
    const origin = new URL(base).origin;
    let redirects = 0;
    while (
      (res.status === 301 || res.status === 302 || res.status === 307 || res.status === 308) &&
      redirects < 5
    ) {
      const location = res.headers.get("location");
      if (!location) break;
      const nextUrl = new URL(location, url);
      if (nextUrl.origin !== origin) {
        die(`Refusing to follow cross-origin redirect to ${nextUrl.origin}`);
      }
      const redirectOpts = { method, headers, redirect: "manual" };
      if (body !== undefined) {
        redirectOpts.body = JSON.stringify(body);
      }
      res = await send(nextUrl, redirectOpts);
      redirects++;
    }

    const text = await res.text();
    if (!res.ok) {
      let msg = text;
      try {
        const j = JSON.parse(text);
        msg = j.error || JSON.stringify(j);
      } catch {
        // not JSON; show the body as it came
      }
      die(`HTTP ${res.status}: ${snippet(msg) || res.statusText}`);
    }
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      // A proxy, login page or wrong AGENTBOARD_URL answers 200 with HTML.
      die(
        `Expected JSON from ${method} ${url} but got ${res.headers.get("content-type") || "an unknown content type"}: ${snippet(text)}`
      );
    }
  }

  // fetch() rejects with a bare "fetch failed" when nothing answers; say
  // which server that was and why, so a wrong URL or DNS failure is obvious.
  async function send(target, opts) {
    try {
      return await fetch(target, opts);
    } catch (err) {
      const cause = err.cause && (err.cause.code || err.cause.message);
      die(`Could not reach ${base}${cause ? ` (${cause})` : ""}: ${err.message}`);
    }
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
    if (!org) die(notFound("Organization", slugOrName, null, orgs, describeNamed, "organizations"));
    return org.id;
  }

  async function resolveProduct(slugOrName) {
    const products = await req("GET", "/api/products");
    // Product slugs are unique per org, not globally — refuse to guess.
    const matches = products.filter((x) => x.slug === slugOrName || x.name === slugOrName);
    if (matches.length === 0) die(notFound("Product", slugOrName, null, products, describeNamed, "products"));
    if (matches.length > 1) {
      die(`'${slugOrName}' matches ${matches.length} products in different orgs; rename one to disambiguate`);
    }
    return matches[0];
  }

  async function resolveProductId(slugOrName) {
    return (await resolveProduct(slugOrName)).id;
  }

  /** `productLabel` names the product in the error; the slug when known. */
  async function resolveBoard(productId, slugOrName, productLabel) {
    const boards = await req("GET", `/api/boards?product_id=${productId}`);
    const b = boards.find((x) => x.slug === slugOrName || x.name === slugOrName);
    if (!b) {
      const where = productLabel ? `product '${productLabel}'` : "this product";
      die(notFound("Board", slugOrName, where, boards, describeBoards, "boards"));
    }
    return b;
  }

  async function resolveBoardId(productId, slugOrName, productLabel) {
    return (await resolveBoard(productId, slugOrName, productLabel)).id;
  }

  async function resolveColumn(boardId, slugOrName) {
    const cols = await req("GET", `/api/columns?board_id=${boardId}`);
    const c = findColumn(cols, slugOrName);
    if (!c) die(notFound("Column", slugOrName, "this board", cols, describeNamed, "columns"));
    return c;
  }

  async function resolveColumnId(boardId, slugOrName) {
    return (await resolveColumn(boardId, slugOrName)).id;
  }

  /**
   * The board a command works on. An explicit board (--board or
   * AGENTBOARD_BOARD) always wins; otherwise the product's own default board.
   */
  async function resolveProductAndBoard(productSlug, boardSlug) {
    const product = await resolveProduct(productSlug);
    if (boardSlug) {
      const board = await resolveBoard(product.id, boardSlug, product.slug);
      return { productId: product.id, boardId: board.id, product, board };
    }
    const boards = await req("GET", `/api/boards?product_id=${product.id}`);
    const picked = pickDefaultBoard(product, boards);
    if (picked) return { productId: product.id, boardId: picked.id, product, board: picked };
    if (!boards || boards.length === 0) die(`Product '${product.slug}' has no boards`);
    die(
      `Product '${product.slug}' has no default board. Pick one with --board <slug> or ` +
        `AGENTBOARD_BOARD, or set the product's default board in Settings. ` +
        `Available: ${describeBoards(boards)}`
    );
  }

  async function findFirstColumn(boardId) {
    const cols = await req("GET", `/api/columns?board_id=${boardId}`);
    if (!cols || cols.length === 0) die("Board has no columns");
    cols.sort((a, b) => a.position - b.position);
    return cols[0];
  }

  async function findFirstColumnId(boardId) {
    return (await findFirstColumn(boardId)).id;
  }

  /**
   * Create a card on a product's board, in the named column or the board's
   * first. Returns the card with where it landed: the server's location fields
   * when it sends them, otherwise what this command resolved (older servers
   * return only the row).
   */
  async function createCard(productSlug, boardSlug, columnSlug, fields) {
    const { product, board } = await resolveProductAndBoard(productSlug, boardSlug);
    const column = columnSlug ? await resolveColumn(board.id, columnSlug) : await findFirstColumn(board.id);
    const card = await req("POST", "/api/cards", { column_id: column.id, ...fields });
    return withCreatedLocation(card, product, board, column);
  }

  return {
    resolveOrgId,
    resolveProduct,
    resolveProductId,
    resolveBoardId,
    resolveColumnId,
    resolveProductAndBoard,
    findFirstColumnId,
    createCard,
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
  status <id> <column>                 Move card to a column slug or name (any case)
                                       (doing/wip -> in-progress, review -> in-review
                                        when the board has no column by that slug)
  show <id>                            Show card details
  rename <id> <title>                  Rename a card
  notes <id>                           View description
    --set <text>  --append <text>
  attention <id> on|off                Set priority to urgent/medium
  my-tasks                             Tasks assigned to AGENTBOARD_AGENT_NAME
  today                                Tasks due today
  past-due                             Overdue tasks

Card ids:
  <id> is a card's number or its readable key: 142, AB-142 or ab-142.
  A card that moved to another product still answers to its old key.

Management Commands:
  org list|add|remove|rename|reorder
  product list|add|remove|rename|move|reorder
    product add --org <slug> <name> [--key <KEY>]   Key prefixes card ids (AB-142)
    product rename <slug> --key <KEY>               Old key keeps working
  board list|add|remove|rename|reorder|view
  column list|add|remove|rename
  member list|add|remove|update
  task add|list|show|move|update|done|remove|link|links|unlink|attach|attachments
    task link <id> --url <url> [--title <text>]   Link any URL: a Slack thread, doc, design
    task link <id> --issue <url> | --pr <url>     Set the card's GitHub issue or PR
    task unlink <id> --url <url>
    task update <id> --add-label <l>              Add labels, keep the rest (a,b or repeat)
    task update <id> --remove-label <l>           Remove only these labels
    task update <id> --label <l>                  Replace all labels ('' clears them)
    task move <id> --column <col>
    task move <id> --to-board <slug> [--column <col>]
    task move <id> --to-product <slug> --to-board <slug> [--column <col>]
  settings [--key <k> --value <v>]
  preferences [--key <k> --value <v>]
  attachment remove <id>
  subtask list <card-id>               Sub-tasks on a card, with progress
  subtask add <card-id> <title>        Add a sub-task to the end of the list
  subtask done|undo <subtask-id>       Check or uncheck a sub-task
  subtask rename <subtask-id> <title>
  subtask remove <subtask-id>

Output:
  --json     JSON output
  --quiet    IDs only

Unknown or unsupported flags are errors. Flag values may start with "--";
use --flag=value or quote as usual.

Environment:
  AGENTBOARD_URL         Server URL (required)
  AGENTBOARD_TOKEN       API key, or the shared password if auth is enabled
  AGENTBOARD_AGENT_NAME  Agent name (auto-registers, used for my-tasks).
                         Ignored where the key already names an agent.
  AGENTBOARD_PRODUCT     Default product slug for simple commands
  AGENTBOARD_BOARD       Board slug override (default: the product's default board)
`;
  process.stdout.write(usage);
}

async function main() {
  const { positional, flags } = parseArgs(process.argv);

  if (flags.version) {
    process.stdout.write(`agentboard ${VERSION}\n`);
    process.exit(0);
  }

  if (positional.length === 0 || flags.help || positional[0] === "help") {
    printUsage();
    process.exit(0);
  }

  checkFlags(positional, flags);

  const remoteUrl = process.env.AGENTBOARD_URL;
  // Named for what it holds rather than for one of the two things it can be:
  // self-hosted sends its shared APP_PASSWORD, hosted sends an API key, and
  // neither is a password to an account — an account created with Google or
  // GitHub has none at all.
  const remoteToken = process.env.AGENTBOARD_TOKEN || "";
  const agentName = process.env.AGENTBOARD_AGENT_NAME || "";
  const envProduct = flags.product || process.env.AGENTBOARD_PRODUCT || "";
  const envBoard = flags.board || process.env.AGENTBOARD_BOARD || "";

  if (!remoteUrl) {
    die(
      "Set AGENTBOARD_URL to the server URL (e.g. https://your-instance.vercel.app). Set AGENTBOARD_TOKEN to an API key, or to the shared password on a self-hosted instance with auth enabled."
    );
  }

  const req = makeReq(remoteUrl, remoteToken, agentName);
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
        const columnId = await resolve.resolveColumnId(boardId, flags.column);
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
      const card = await resolve.createCard(scope.product, scope.board, flags.column, newCardFields(title, flags));
      outputCreated(card, flags);
    }

    // ---- status ----
    else if (cmd === "status") {
      const cardId = positional[1];
      const statusName = positional[2];
      if (!cardId || !statusName) die("Usage: agentboard status <id> <status>");

      // Get columns for the card's board
      const cols = await req("GET", `/api/columns/by-card/${cardId}`);
      if (!cols || cols.length === 0) die("Could not determine board for card");

      const targetCol = findColumn(cols, statusName);
      if (!targetCol) {
        die(`Column '${statusName}' not found on this board. Available: ${describeNamed(cols)}`);
      }

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
      //
      // An agent and a colleague may share a name, and /api/members lists humans
      // first, so a bare name match handed an agent called Alex the tasks
      // belonging to the human Alex. When the name came from
      // AGENTBOARD_AGENT_NAME it means an agent and nothing else; --assignee is
      // a person asking about anybody, so it still matches either.
      const members = await req("GET", "/api/members");
      const byName = (m) => m.name.toLowerCase() === assignee.toLowerCase();
      const byId = (m) => String(m.id) === String(assignee);
      const askingAboutSelf = !flags.assignee;
      const member =
        (askingAboutSelf
          ? members.find((m) => m.type === "agent" && (byName(m) || byId(m)))
          : undefined) || members.find((m) => byName(m) || byId(m));

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
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
      const data = await req("GET", `/api/cards/views?view=today&tz=${encodeURIComponent(tz)}`);
      output(data, flags);
    }

    // ---- past-due ----
    else if (cmd === "past-due") {
      const assignee = flags.assignee || agentName;
      if (!assignee) die("Set AGENTBOARD_AGENT_NAME or pass --assignee <name>");

      const members = await req("GET", "/api/members");
      const member = members.find(
        (m) => m.name.toLowerCase() === assignee.toLowerCase() || String(m.id) === String(assignee)
      );
      if (!member) die(`Member not found: ${assignee}`);

      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
      const data = await req(
        "GET",
        `/api/cards/views?view=past-due&member_id=${member.id}&tz=${encodeURIComponent(tz)}`
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
            emoji: flags.emoji,
            key: flags.key,
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
        if (!slug) die("Usage: agentboard product rename <slug> [--name <n>] [--emoji <e>] [--key <KEY>]");
        const productId = await resolve.resolveProductId(slug);
        const body = {};
        if (flags.name) body.name = flags.name;
        if (flags.emoji) body.emoji = flags.emoji;
        if (flags.key) body.key = flags.key;
        if (Object.keys(body).length === 0) die("Provide --name, --emoji or --key");
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
        const card = await resolve.createCard(productSlug, boardSlug, flags.column, newCardFields(title, flags));
        outputCreated(card, flags);
      } else if (sub === "list") {
        const productSlug = flags.product || envProduct;
        const boardSlug = flags.board || envBoard;
        if (!productSlug) die("--product is required (or set AGENTBOARD_PRODUCT)");
        const { boardId } = await resolve.resolveProductAndBoard(productSlug, boardSlug);
        const params = new URLSearchParams({ board_id: boardId });
        if (flags.column) {
          const columnId = await resolve.resolveColumnId(boardId, flags.column);
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
        const usage =
          "Usage: agentboard task move <card-id> --column <slug>\n" +
          "       agentboard task move <card-id> --to-board <slug> [--column <slug>]\n" +
          "       agentboard task move <card-id> --to-product <slug> --to-board <slug> [--column <slug>]";
        if (!id || !(flags.column || flags["to-board"] || flags["to-product"])) die(usage);
        // A product has several boards; picking one silently would be a guess.
        if (flags["to-product"] && !flags["to-board"]) {
          die("--to-product requires --to-board (a product has several boards)");
        }

        const card = await req("GET", `/api/cards/${id}`);
        // Servers before this CLI release don't say where a card lives, which
        // only matters when we need its product or current column.
        const needsLocation =
          (flags["to-board"] && !flags["to-product"]) || !flags.column;
        if (needsLocation && (card.product_id === undefined || card.column_slug === undefined)) {
          die("This server is too old for that move; update AgentBoard, or pass --to-product and --column.");
        }

        let cols;
        let where;
        if (flags["to-board"]) {
          const product = flags["to-product"] ? await resolve.resolveProduct(flags["to-product"]) : null;
          const productId = product ? product.id : card.product_id;
          const boardId = await resolve.resolveBoardId(
            productId,
            flags["to-board"],
            product ? product.slug : card.product_slug
          );
          cols = await req("GET", `/api/columns?board_id=${boardId}`);
          where = `board '${flags["to-board"]}'`;
        } else {
          cols = await req("GET", `/api/columns/by-card/${id}`);
          where = "this board";
        }
        if (!cols || cols.length === 0) die(`No columns found on ${where}`);

        // Keep the card's current column unless one is named; never fall back
        // to some other column when the slug is missing on the destination.
        const colSlug = flags.column || card.column_slug;
        const targetCol = flags.column
          ? findColumn(cols, flags.column)
          : cols.find((c) => c.slug === colSlug);
        if (!targetCol) {
          die(
            `Column '${colSlug}' not found on ${where}. Available: ${cols.map((c) => c.slug).join(", ")}`
          );
        }
        output(
          await req("PATCH", `/api/cards/${id}/move`, { column_id: targetCol.id }),
          flags
        );
      } else if (sub === "update") {
        const id = positional[2];
        if (!id) die("Usage: agentboard task update <card-id> [--field value]");
        const labelEdit = parseLabelEdit(flags);
        const updates = {};
        if (flags.title) updates.title = flags.title;
        if (flags.description) updates.description = flags.description;
        if (flags.assignee) updates.assignee = flags.assignee;
        if (flags.priority) updates.priority = flags.priority;
        if (flags.label !== undefined) updates.labels = flags.label;
        if (flags.due) updates.due_date = flags.due;
        if (flags.issue) updates.github_issue_url = flags.issue;
        if (flags.pr) updates.github_pr_url = flags.pr;
        if (labelEdit) {
          // Read the card's labels and write back the edited list. This is a
          // read-then-write, so a label edit made by someone else in between
          // can be lost; the window is one round trip.
          const card = await req("GET", `/api/cards/${id}`);
          const result = applyLabelEdit(card.labels, labelEdit);
          for (const note of result.notes) process.stderr.write(`${note.replace("{id}", id)}\n`);
          if (result.changed) updates.labels = result.labels;
          if (Object.keys(updates).length === 0) {
            output(card, flags);
            return;
          }
        }
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
        const usage = "Usage: agentboard task link <card-id> --url <url> [--title <text>] | --issue <url> | --pr <url>";
        const id = positional[2];
        if (!id) die(usage);
        // --url links anything (a Slack thread, a doc, a design); --issue and
        // --pr fill the card's GitHub fields.
        const body = {};
        if (flags.issue) body.github_issue_url = flags.issue;
        if (flags.pr) body.github_pr_url = flags.pr;
        if (flags.title !== undefined && !flags.url) die(`--title requires --url. ${usage}`);
        if (Object.keys(body).length === 0 && !flags.url) die(`Provide --url, --issue or --pr. ${usage}`);
        let result;
        if (flags.url) {
          const link = { url: flags.url };
          if (flags.title !== undefined) link.title = flags.title;
          result = await req("POST", `/api/cards/${id}/links`, link);
        }
        if (Object.keys(body).length > 0) result = await req("PATCH", `/api/cards/${id}`, body);
        output(result, flags);
      } else if (sub === "links") {
        const id = positional[2];
        if (!id) die("Usage: agentboard task links <card-id>");
        const links = await req("GET", `/api/cards/${id}/links`);
        if (flags.json || flags.quiet || !Array.isArray(links)) {
          output(links, flags);
        } else if (links.length === 0) {
          console.log("No links.");
        } else {
          for (const l of links) console.log(l.title ? `${l.title}  ${l.url}` : l.url);
        }
      } else if (sub === "unlink") {
        const usage = "Usage: agentboard task unlink <card-id> --url <url>";
        const id = positional[2];
        if (!id || !flags.url) die(usage);
        output(await req("DELETE", `/api/cards/${id}/links`, { url: flags.url }), flags);
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
          `Unknown task command: ${sub}. Use: add, list, show, move, update, done, remove, link, links, unlink, attach, attachments, reorder`
        );
      }
    }

    // ---- settings ----
    else if (cmd === "settings") {
      // Half a write, or an empty key, would otherwise fall through to a read
      // and exit 0. Validation and dispatch use the same condition.
      const isWrite = flags.key !== undefined || flags.value !== undefined;
      if (isWrite && (flags.key === undefined || flags.value === undefined)) {
        die("Pass both --key and --value to change a setting, or neither to list them.");
      }
      if (isWrite && String(flags.key).trim() === "") {
        die("--key can't be empty.");
      }
      if (isWrite) {
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
      // Half a write, or an empty key, would otherwise fall through to a read
      // and exit 0. Validation and dispatch use the same condition.
      const isWrite = flags.key !== undefined || flags.value !== undefined;
      if (isWrite && (flags.key === undefined || flags.value === undefined)) {
        die("Pass both --key and --value to change a preference, or neither to list them.");
      }
      if (isWrite && String(flags.key).trim() === "") {
        die("--key can't be empty.");
      }
      if (isWrite) {
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

    // ---- subtask ----
    else if (cmd === "subtask") {
      const id = positional[2];
      const rest = positional.slice(3).join(" ").trim();
      const usage = {
        list: "Usage: agentboard subtask list <card-id>",
        add: "Usage: agentboard subtask add <card-id> <title>",
        done: "Usage: agentboard subtask done <subtask-id>",
        undo: "Usage: agentboard subtask undo <subtask-id>",
        rename: "Usage: agentboard subtask rename <subtask-id> <title>",
        remove: "Usage: agentboard subtask remove <subtask-id>",
      }[sub];
      if (!usage) die(`Unknown subtask command: ${sub}. Use: list, add, done, undo, rename, remove`);
      if (!id) die(usage);
      // A card is named by its number or readable key (AB-142); a sub-task
      // only by its number. Catches a title given where the id belongs.
      const onCard = sub === "list" || sub === "add";
      const idPattern = onCard ? /^([1-9][0-9]*|[A-Za-z][A-Za-z0-9]{1,9}-[1-9][0-9]*)$/ : /^[1-9][0-9]*$/;
      if (!idPattern.test(id)) {
        die(`${onCard ? "card id must be a number or a key like AB-142" : "subtask id must be a number"}. ${usage}`);
      }
      if ((sub === "add" || sub === "rename") && !rest) die(usage);

      if (sub === "list") {
        const items = await req("GET", `/api/cards/${id}/subtasks`);
        if (flags.json || flags.quiet) {
          output(items, flags);
        } else if (items.length === 0) {
          process.stdout.write("(no sub-tasks)\n");
        } else {
          const w = Math.max(...items.map((t) => String(t.id).length));
          for (const t of items) {
            process.stdout.write(`${t.done ? "[x]" : "[ ]"} ${String(t.id).padEnd(w)}  ${t.title}\n`);
          }
          const done = items.filter((t) => t.done).length;
          process.stdout.write(`${done}/${items.length} done\n`);
        }
      } else if (sub === "add") {
        output(await req("POST", `/api/cards/${id}/subtasks`, { title: rest }), flags);
      } else if (sub === "done" || sub === "undo") {
        output(await req("PATCH", `/api/subtasks/${id}`, { done: sub === "done" }), flags);
      } else if (sub === "rename") {
        output(await req("PATCH", `/api/subtasks/${id}`, { title: rest }), flags);
      } else {
        output(await req("DELETE", `/api/subtasks/${id}`), flags);
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

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`${err.message || err}\n`);
    process.exit(1);
  });
}

module.exports = {
  main,
  parseArgs,
  formatTable,
  output,
  createdLine,
  withCreatedLocation,
  printUsage,
  COMMAND_FLAGS,
  parseLabelEdit,
  applyLabelEdit,
};
