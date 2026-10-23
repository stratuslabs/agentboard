// Board-scoped commands (`list`, `new`, `task list`, ...) need a board. The CLI
// used to fall back to a board slugged `development`, so a product without one
// failed on a fresh install. Now the product's own default board is used, a
// product with exactly one board needs no setup, and AGENTBOARD_BOARD / --board
// is an optional override.
//
//   node --test test/

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../cli/agentboard.js", import.meta.url));

const PRODUCTS = [
  // Default set to the second board: the CLI must not pick by position.
  { id: 1, slug: "multi", name: "Multi", default_board_id: 12 },
  // One board and no default: nothing to choose between.
  { id: 2, slug: "single", name: "Single", default_board_id: null },
  // Several boards, no default, none called development.
  { id: 3, slug: "none", name: "None", default_board_id: null },
  // An older server that doesn't know about default boards at all.
  { id: 4, slug: "legacy", name: "Legacy" },
  // A newer server where the product has a development board but no default:
  // it must not silently fall back to it.
  { id: 5, slug: "unset", name: "Unset", default_board_id: null },
];

const BOARDS = {
  1: [
    { id: 11, product_id: 1, slug: "development", name: "Development", position: 0 },
    { id: 12, product_id: 1, slug: "ops", name: "Ops", position: 1 },
  ],
  2: [{ id: 21, product_id: 2, slug: "tasks", name: "Tasks", position: 0 }],
  3: [
    { id: 31, product_id: 3, slug: "alpha", name: "Alpha", position: 0 },
    { id: 32, product_id: 3, slug: "beta", name: "Beta", position: 1 },
  ],
  4: [
    { id: 41, product_id: 4, slug: "other", name: "Other", position: 0 },
    { id: 42, product_id: 4, slug: "development", name: "Development", position: 1 },
  ],
  5: [
    { id: 51, product_id: 5, slug: "development", name: "Development", position: 0 },
    { id: 52, product_id: 5, slug: "ops", name: "Ops", position: 1 },
  ],
};

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
        const b = Number(columns[1]);
        res.end(JSON.stringify([{ id: b * 10, board_id: b, name: "Todo", slug: "todo", position: 0 }]));
      } else if (req.method === "GET" && req.url.startsWith("/api/cards?")) {
        res.end(JSON.stringify([]));
      } else if (req.method === "POST" && req.url === "/api/cards") {
        res.end(JSON.stringify({ id: 99, ...body }));
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
  const env = { ...process.env, AGENTBOARD_URL: baseUrl, AGENTBOARD_TOKEN: "", AGENTBOARD_AGENT_NAME: "" };
  delete env.AGENTBOARD_PRODUCT;
  delete env.AGENTBOARD_BOARD;
  Object.assign(env, extraEnv);
  return new Promise((resolve) => {
    execFile(process.execPath, [CLI, ...args], { env }, (err, stdout, stderr) =>
      resolve({ code: err ? err.code : 0, stdout, stderr }),
    );
  });
}

const cardsRequest = () => requests.find((q) => q.method === "GET" && q.url.startsWith("/api/cards?"));

test("with no board given, list uses the product's default board", async () => {
  const r = await run(["list", "--product", "multi", "--json"]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(cardsRequest().url, /board_id=12\b/);
});

test("--board overrides the product's default", async () => {
  const r = await run(["list", "--product", "multi", "--board", "development", "--json"]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(cardsRequest().url, /board_id=11\b/);
});

test("AGENTBOARD_BOARD overrides the product's default", async () => {
  const r = await run(["list", "--product", "multi", "--json"], { AGENTBOARD_BOARD: "development" });
  assert.equal(r.code, 0, r.stderr);
  assert.match(cardsRequest().url, /board_id=11\b/);
});

test("a product with exactly one board needs no default", async () => {
  const r = await run(["list", "--product", "single", "--json"]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(cardsRequest().url, /board_id=21\b/);
});

test("several boards and no default: refuse, touch nothing, list the boards", async () => {
  const r = await run(["new", "Hello", "--product", "none"]);
  assert.notEqual(r.code, 0);
  assert.equal(requests.filter((q) => q.method !== "GET").length, 0);
  assert.match(r.stderr, /no default board/i);
  assert.match(r.stderr, /alpha \(Alpha\), beta \(Beta\)/);
  assert.match(r.stderr, /--board|AGENTBOARD_BOARD/);
});

test("a development board is not a silent fallback when the server knows defaults", async () => {
  const r = await run(["list", "--product", "unset", "--json"]);
  assert.notEqual(r.code, 0);
  assert.equal(cardsRequest(), undefined);
  assert.match(r.stderr, /development \(Development\), ops \(Ops\)/);
});

test("an older server without default boards still gets the development board", async () => {
  const r = await run(["list", "--product", "legacy", "--json"]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(cardsRequest().url, /board_id=42\b/);
});

test("new creates the card on the default board", async () => {
  const r = await run(["new", "Hello", "--product", "multi", "--json"]);
  assert.equal(r.code, 0, r.stderr);
  const post = requests.find((q) => q.method === "POST");
  assert.equal(post.body.column_id, 120);
});

test("task list without --board uses the default board", async () => {
  const r = await run(["task", "list", "--product", "multi", "--json"]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(cardsRequest().url, /board_id=12\b/);
});
