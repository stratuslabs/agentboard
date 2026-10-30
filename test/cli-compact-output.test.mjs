// `list`, `task list` and `my-tasks` say where each card is without dumping
// the board: every card carries its column, board and product (filled in by
// the CLI when an older server sends only column_id), `--fields` picks what to
// print, `list`'s table is five columns wide, and a table names the board it
// read so a product pinned by the environment is never a silent surprise.
//
//   node --test test/

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../cli/agentboard.js", import.meta.url));

const PRODUCTS = [
  { id: 1, slug: "web", name: "Web App", default_board_id: 11 },
  { id: 2, slug: "infra", name: "Infra", default_board_id: 21 },
];
const BOARDS = {
  1: [{ id: 11, product_id: 1, slug: "development", name: "Development", position: 0 }],
  2: [{ id: 21, product_id: 2, slug: "ops", name: "Ops", position: 0 }],
};
const COLUMNS = {
  11: [
    { id: 111, board_id: 11, slug: "todo", name: "Todo", position: 0 },
    { id: 112, board_id: 11, slug: "in-review", name: "In Review", position: 1 },
    { id: 113, board_id: 11, slug: "done", name: "Done", position: 2 },
  ],
  21: [{ id: 211, board_id: 21, slug: "backlog", name: "Inbox", position: 0 }],
};

// What an older server sends for /api/cards: column_id, but nothing about the
// column, board or product it points at.
const CARDS = {
  11: [
    {
      id: 1, title: "Ship the thing", column_id: 111, assignee: null, assignee_name: "Remy",
      priority: "high", labels: "cli", description: "a long description nobody asked for",
    },
    {
      id: 2, title: "Legacy text assignee", column_id: 112, assignee: "Nova", assignee_name: null,
      priority: "low", labels: "", description: "",
    },
    { id: 3, title: "Finished", column_id: 113, assignee: null, assignee_name: null, priority: "medium" },
  ],
  21: [
    // A newer server already names the column; that wins over the CLI's fill.
    { id: 4, title: "Infra card", column_id: 211, column_name: "Inbox (server)", priority: "medium" },
  ],
};

const MEMBERS = [{ id: 7, name: "Remy", type: "agent" }];
// The assigned view names product, board and column; older ones have no slugs.
const ASSIGNED = [
  {
    id: 1, title: "Ship the thing", column_id: 111, priority: "high",
    product_name: "Web App", board_name: "Development", column_name: "Todo",
  },
  {
    id: 4, title: "Infra card", column_id: 211, priority: "medium",
    product_name: "Infra", product_slug: "infra", board_name: "Ops", board_slug: "ops",
    column_name: "Inbox",
  },
];

let requests = [];
let server;
let baseUrl;

before(async () => {
  server = http.createServer((req, res) => {
    requests.push({ method: req.method, url: req.url });
    res.setHeader("Content-Type", "application/json");
    const u = new URL(req.url, "http://x");
    const send = (data) => res.end(JSON.stringify(data));
    if (u.pathname === "/api/products") return send(PRODUCTS);
    if (u.pathname === "/api/boards") return send(BOARDS[u.searchParams.get("product_id")] ?? []);
    if (u.pathname === "/api/columns") return send(COLUMNS[u.searchParams.get("board_id")] ?? []);
    if (u.pathname === "/api/members") return send(MEMBERS);
    if (u.pathname === "/api/cards/views") return send(ASSIGNED);
    if (u.pathname === "/api/cards") {
      if (u.searchParams.get("assignee")) return send([]);
      let cards = CARDS[u.searchParams.get("board_id")] ?? [];
      const col = u.searchParams.get("column_id");
      if (col) cards = cards.filter((c) => String(c.column_id) === col);
      return send(cards);
    }
    res.statusCode = 404;
    send({ error: "Not found" });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((r) => server.close(r)));

function run(args, extraEnv = {}) {
  requests = [];
  const env = { ...process.env, AGENTBOARD_URL: baseUrl, AGENTBOARD_TOKEN: "", AGENTBOARD_AGENT_NAME: "Remy" };
  delete env.AGENTBOARD_PRODUCT;
  delete env.AGENTBOARD_BOARD;
  Object.assign(env, extraEnv);
  return new Promise((resolve) => {
    execFile(process.execPath, [CLI, ...args], { env }, (err, stdout, stderr) =>
      resolve({ code: err ? err.code : 0, stdout, stderr }),
    );
  });
}

const lines = (s) => s.split("\n").filter((l) => l.length > 0);
const cells = (line) => line.trim().split(/\s{2,}/);

test("list's table is id, title, column, assignee and priority, under the board it read", async () => {
  const r = await run(["list", "--product", "web"]);
  assert.equal(r.code, 0, r.stderr);
  const [where, header, , ...rows] = lines(r.stdout);
  assert.equal(where, "Board: web/development (Web App / Development)");
  assert.deepEqual(cells(header), ["id", "title", "column", "assignee", "priority"]);
  assert.deepEqual(rows.map(cells), [
    ["1", "Ship the thing", "Todo", "Remy", "high"],
    // A card from before members existed still shows who has it.
    ["2", "Legacy text assignee", "In Review", "Nova", "low"],
  ]);
  assert.doesNotMatch(r.stdout, /description/);
});

test("list reads AGENTBOARD_PRODUCT and says so", async () => {
  const r = await run(["list"], { AGENTBOARD_PRODUCT: "infra" });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(lines(r.stdout)[0], "Board: infra/ops (Infra / Ops)");
  assert.ok(requests.some((q) => q.url.startsWith("/api/cards?") && /board_id=21\b/.test(q.url)));
});

test("list --json says which column, board and product each card is on", async () => {
  const r = await run(["list", "--product", "web", "--json"]);
  assert.equal(r.code, 0, r.stderr);
  const [card] = JSON.parse(r.stdout);
  assert.equal(card.column_name, "Todo");
  assert.equal(card.column_slug, "todo");
  assert.equal(card.board_id, 11);
  assert.equal(card.board_slug, "development");
  assert.equal(card.board_name, "Development");
  assert.equal(card.product_id, 1);
  assert.equal(card.product_slug, "web");
  assert.equal(card.product_name, "Web App");
  // Everything the server sent is still there.
  assert.equal(card.description, "a long description nobody asked for");
});

test("task list --json fills column_name, and a value the server sent wins", async () => {
  const web = await run(["task", "list", "--product", "web", "--json"]);
  assert.equal(web.code, 0, web.stderr);
  assert.deepEqual(JSON.parse(web.stdout).map((c) => c.column_name), ["Todo", "In Review", "Done"]);

  const infra = await run(["task", "list", "--product", "infra", "--json"]);
  assert.equal(infra.code, 0, infra.stderr);
  const [card] = JSON.parse(infra.stdout);
  assert.equal(card.column_name, "Inbox (server)");
  assert.equal(card.column_slug, "backlog");
});

test("my-tasks --fields prints one short line per card, product by slug where the server gives one", async () => {
  const r = await run(["my-tasks", "--fields", "id,product,column,title"]);
  assert.equal(r.code, 0, r.stderr);
  const [header, , ...rows] = lines(r.stdout);
  assert.deepEqual(cells(header), ["id", "product", "column", "title"]);
  assert.deepEqual(rows.map(cells), [
    ["1", "Web App", "Todo", "Ship the thing"],
    ["4", "infra", "Inbox", "Infra card"],
  ]);
});

test("my-tasks' default table names product, board and column instead of every field", async () => {
  const r = await run(["my-tasks"]);
  assert.equal(r.code, 0, r.stderr);
  const [header, , ...rows] = lines(r.stdout);
  assert.deepEqual(cells(header), ["id", "title", "product", "board", "column", "priority"]);
  assert.deepEqual(cells(rows[1]), ["4", "Infra card", "infra", "ops", "Inbox", "medium"]);
});

test("--fields with --json keeps only those fields", async () => {
  const r = await run(["list", "--product", "web", "--json", "--fields", "id, column ,assignee"]);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), [
    { id: 1, column: "Todo", assignee: "Remy" },
    { id: 2, column: "In Review", assignee: "Nova" },
  ]);
});

test("--fields names a raw card field too", async () => {
  const r = await run(["task", "list", "--product", "web", "--fields", "id,labels,column_slug"]);
  assert.equal(r.code, 0, r.stderr);
  const [, header, , first] = lines(r.stdout);
  assert.deepEqual(cells(header), ["id", "labels", "column_slug"]);
  assert.deepEqual(cells(first), ["1", "cli", "todo"]);
});

test("an unknown field is an error that lists the real ones", async () => {
  const r = await run(["list", "--product", "web", "--fields", "id,colum"]);
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /Unknown field: colum\. Available: .*\bcolumn\b/);
  assert.equal(r.stdout, "");
});

test("--fields can't be empty or combined with --quiet", async () => {
  const empty = await run(["my-tasks", "--fields", " , "]);
  assert.notEqual(empty.code, 0);
  assert.match(empty.stderr, /--fields needs at least one field/);

  const quiet = await run(["list", "--product", "web", "--quiet", "--fields", "id,title"]);
  assert.notEqual(quiet.code, 0);
  assert.match(quiet.stderr, /--quiet prints ids only/);
});

test("--quiet still prints only ids, with no board line", async () => {
  const r = await run(["list", "--product", "web", "--quiet"]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, "1\n2\n");
});

test("commands that don't print cards refuse --fields", async () => {
  const r = await run(["show", "1", "--fields", "id"]);
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /'show' does not accept --fields/);
});
