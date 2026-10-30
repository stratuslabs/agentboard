// `agentboard new` and `agentboard task add` say where the card landed: the
// product, board and column, in the text output and in --json. A card that
// lands on the wrong product (an env var stripped by a launcher, a default
// board nobody expected) should be obvious from the command's own output.
//
//   node --test test/

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../cli/agentboard.js", import.meta.url));

const PRODUCTS = [
  { id: 1, slug: "infra", name: "Infra", default_board_id: 12 },
  // An older server: no default board field, and no location on created cards.
  { id: 2, slug: "legacy", name: "Legacy" },
];

const BOARDS = {
  1: [
    { id: 11, product_id: 1, slug: "development", name: "Development", position: 0 },
    { id: 12, product_id: 1, slug: "ops", name: "Ops", position: 1 },
  ],
  2: [{ id: 21, product_id: 2, slug: "development", name: "Development", position: 0 }],
};

const COLUMNS = {
  11: [
    { id: 111, board_id: 11, name: "Backlog", slug: "backlog", position: 0 },
    { id: 112, board_id: 11, name: "In Review", slug: "in-review", position: 1 },
  ],
  12: [
    { id: 121, board_id: 12, name: "Inbox", slug: "inbox", position: 0 },
    { id: 122, board_id: 12, name: "Todo", slug: "todo", position: 1 },
  ],
  21: [{ id: 211, board_id: 21, name: "Todo", slug: "todo", position: 0 }],
};

const BOARD_OF_COLUMN = { 111: 11, 112: 11, 121: 12, 122: 12, 211: 21 };

/**
 * What a current server sends back from POST /api/cards: the card with its
 * location and readable key. Product 2 plays an older server that returns only
 * the row.
 */
function created(body) {
  const boardId = BOARD_OF_COLUMN[body.column_id];
  const board = Object.values(BOARDS).flat().find((b) => b.id === boardId);
  const product = PRODUCTS.find((p) => p.id === board.product_id);
  const column = COLUMNS[boardId].find((c) => c.id === body.column_id);
  const row = { id: 501, number: 7, ...body };
  if (product.id === 2) return row;
  return {
    ...row,
    key: "INF-7",
    column_slug: column.slug,
    column_name: column.name,
    board_id: board.id,
    board_slug: board.slug,
    board_name: board.name,
    product_id: product.id,
    product_slug: product.slug,
    product_name: product.name,
  };
}

/** @type {{ method: string, url: string, body: unknown }[]} */
let requests = [];
let server;
let baseUrl;

before(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : undefined;
      requests.push({ method: req.method, url: req.url, body });
      res.setHeader("Content-Type", "application/json");
      const boards = req.url.match(/^\/api\/boards\?product_id=(\d+)$/);
      const columns = req.url.match(/^\/api\/columns\?board_id=(\d+)$/);
      if (req.method === "GET" && req.url === "/api/products") {
        res.end(JSON.stringify(PRODUCTS));
      } else if (req.method === "GET" && boards) {
        res.end(JSON.stringify(BOARDS[boards[1]] ?? []));
      } else if (req.method === "GET" && columns) {
        res.end(JSON.stringify(COLUMNS[columns[1]] ?? []));
      } else if (req.method === "POST" && req.url === "/api/cards") {
        res.statusCode = 201;
        res.end(JSON.stringify(created(body)));
      } else {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: "Not found" }));
      }
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((r) => server.close(r)));

function run(args, extraEnv = {}) {
  requests = [];
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [CLI, ...args],
      {
        env: {
          ...process.env,
          AGENTBOARD_URL: baseUrl,
          AGENTBOARD_TOKEN: "",
          AGENTBOARD_AGENT_NAME: "",
          AGENTBOARD_PRODUCT: "",
          AGENTBOARD_BOARD: "",
          ...extraEnv,
        },
      },
      (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr }),
    );
  });
}

const firstLine = (s) => s.split("\n")[0];

test("new: the text output starts with where the card landed", async () => {
  const r = await run(["new", "Fix it", "--product", "infra"]);
  assert.equal(r.code, 0, r.stderr);
  // The product's default board is ops, and its first column is Inbox.
  assert.equal(firstLine(r.stdout), "Created INF-7 on infra/ops in Inbox");
});

test("new: an explicit board and column are what the line names", async () => {
  const r = await run(["new", "Fix it", "--product", "infra", "--board", "development", "--column", "in-review"]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(firstLine(r.stdout), "Created INF-7 on infra/development in In Review");
});

test("new: the product and board from the environment are named too", async () => {
  const r = await run(["new", "Fix it"], { AGENTBOARD_PRODUCT: "infra", AGENTBOARD_BOARD: "development" });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(firstLine(r.stdout), "Created INF-7 on infra/development in Backlog");
});

test("new: the card's fields still follow the summary line", async () => {
  const r = await run(["new", "Fix it", "--product", "infra"]);
  assert.equal(r.code, 0, r.stderr);
  const rest = r.stdout.split("\n").slice(1).join("\n");
  assert.match(rest, /^id\s+501$/m);
  assert.match(rest, /^title\s+Fix it$/m);
});

test("new --json: the card includes its product, board and column", async () => {
  const r = await run(["new", "Fix it", "--product", "infra", "--json"]);
  assert.equal(r.code, 0, r.stderr);
  const card = JSON.parse(r.stdout);
  assert.equal(card.id, 501);
  assert.equal(card.product_slug, "infra");
  assert.equal(card.product_name, "Infra");
  assert.equal(card.board_slug, "ops");
  assert.equal(card.board_name, "Ops");
  assert.equal(card.column_slug, "inbox");
  assert.equal(card.column_name, "Inbox");
  assert.equal(card.key, "INF-7");
});

test("new --quiet: still prints only the id", async () => {
  const r = await run(["new", "Fix it", "--product", "infra", "--quiet"]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, "501\n");
});

test("new on an older server: the CLI fills in the location it resolved", async () => {
  const r = await run(["new", "Old", "--product", "legacy", "--json"]);
  assert.equal(r.code, 0, r.stderr);
  const card = JSON.parse(r.stdout);
  assert.equal(card.product_id, 2);
  assert.equal(card.product_slug, "legacy");
  assert.equal(card.product_name, "Legacy");
  assert.equal(card.board_id, 21);
  assert.equal(card.board_slug, "development");
  assert.equal(card.board_name, "Development");
  assert.equal(card.column_slug, "todo");
  assert.equal(card.column_name, "Todo");
  // No readable key without the server's help.
  assert.equal(card.key, undefined);
});

test("new on an older server: the text line falls back to the card id", async () => {
  const r = await run(["new", "Old", "--product", "legacy"]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(firstLine(r.stdout), "Created card 501 on legacy/development in Todo");
});

test("task add: the text output starts with where the card landed", async () => {
  const r = await run(["task", "add", "Fix it", "--product", "infra", "--board", "development"]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(firstLine(r.stdout), "Created INF-7 on infra/development in Backlog");
});

test("task add --json: the card includes its product, board and column", async () => {
  const r = await run(["task", "add", "Fix it", "--product", "infra", "--column", "todo", "--json"]);
  assert.equal(r.code, 0, r.stderr);
  const card = JSON.parse(r.stdout);
  assert.equal(card.product_slug, "infra");
  assert.equal(card.board_slug, "ops");
  assert.equal(card.column_name, "Todo");
});

test("task add on an older server: the location comes from the CLI", async () => {
  const r = await run(["task", "add", "Old", "--product", "legacy", "--json"]);
  assert.equal(r.code, 0, r.stderr);
  const card = JSON.parse(r.stdout);
  assert.equal(card.product_slug, "legacy");
  assert.equal(card.board_slug, "development");
  assert.equal(card.column_slug, "todo");
});

test("the request body is unchanged: only column_id says where the card goes", async () => {
  await run(["new", "Fix it", "--product", "infra", "--column", "todo"]);
  const post = requests.find((q) => q.method === "POST");
  assert.deepEqual(post.body, {
    column_id: 122,
    title: "Fix it",
    description: "",
    priority: "medium",
    labels: "",
  });
});
