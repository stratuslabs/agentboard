// `agentboard search <text>` (AB-111) finds cards by words in their title,
// description or labels, or by key, across every product, so checking whether
// a card already exists doesn't mean listing every board and grepping titles.
// Done is hidden unless --include-done, and --product narrows to one product.
//
// The fake server below answers GET /api/cards/search the way a server from
// before AB-111 does (Cloud until its core pin moves): it ignores product_id
// and exclude_done, so the CLI has to filter what comes back as well as ask
// the server to.
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

// Rows as GET /api/cards/search sends them. The older server has no
// product_id or board_slug; one newer row has both.
const ROWS = [
  {
    id: 1, key: "WEB-1", title: "CLI: task link takes any URL", product_slug: "web", product_name: "Web App",
    board_name: "Development", column_name: "Todo", done: false, url: "http://x/c/WEB-1",
  },
  {
    id: 2, key: "INF-4", title: "Runner docs", product_slug: "infra", product_name: "Infra",
    board_name: "Ops", column_name: "Inbox", done: false, url: "http://x/c/INF-4",
    description: "mentions task link in passing",
  },
  {
    id: 3, key: "WEB-2", title: "Old task link bug", product_slug: "web", product_name: "Web App",
    board_name: "Development", column_name: "Done", done: true, url: "http://x/c/WEB-2",
  },
  {
    id: 4, key: "INF-5", title: "task link in the runner", product_id: 2, product_slug: "infra",
    product_name: "Infra", board_name: "Ops", board_slug: "ops", column_name: "Todo", done: false,
    url: "http://x/c/INF-5",
  },
];
const BULK = Array.from({ length: 50 }, (_, i) => ({
  id: 100 + i, key: `WEB-${100 + i}`, title: `Bulk ${i}`, product_slug: "web", product_name: "Web App",
  board_name: "Development", column_name: "Todo", done: false,
}));

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
    if (u.pathname === "/api/cards/search") {
      const q = u.searchParams.get("q");
      if (q === "bulk") return send(BULK);
      if (q === "nothing") return send([]);
      if (q !== "unsupported") return send(ROWS);
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
  delete env.AGENTBOARD_CONFIG;
  Object.assign(env, extraEnv);
  return new Promise((resolve) => {
    execFile(process.execPath, [CLI, ...args], { env }, (err, stdout, stderr) =>
      resolve({ code: err ? err.code : 0, stdout, stderr }),
    );
  });
}

const lines = (s) => s.split("\n").filter((l) => l.length > 0);
const cells = (line) => line.trim().split(/\s{2,}/);
const searches = () =>
  requests.filter((r) => r.url.startsWith("/api/cards/search")).map((r) => new URL(r.url, "http://x").searchParams);

test("search finds open cards in every product, even with AGENTBOARD_PRODUCT set", async () => {
  const r = await run(["search", "task link"], { AGENTBOARD_PRODUCT: "web" });
  assert.equal(r.code, 0, r.stderr);
  const [sent] = searches();
  assert.equal(sent.get("q"), "task link");
  assert.equal(sent.get("limit"), "50");
  assert.equal(sent.get("exclude_done"), "1");
  assert.equal(sent.has("product_id"), false, "AGENTBOARD_PRODUCT doesn't narrow a search");

  const [header, , ...rows] = lines(r.stdout);
  assert.deepEqual(cells(header), ["key", "title", "product", "board", "column"]);
  assert.deepEqual(rows.map(cells), [
    ["WEB-1", "CLI: task link takes any URL", "web", "Development", "Todo"],
    ["INF-4", "Runner docs", "infra", "Ops", "Inbox"],
    // A newer server's board slug wins over the name.
    ["INF-5", "task link in the runner", "infra", "ops", "Todo"],
  ]);
  assert.doesNotMatch(r.stdout, /WEB-2/, "a card in Done is hidden even when the server sends it");
});

test("the words don't need quotes", async () => {
  const r = await run(["search", "task", "link"]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(searches()[0].get("q"), "task link");
});

test("--include-done keeps cards in Done", async () => {
  const r = await run(["search", "task link", "--include-done", "--quiet"]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(searches()[0].has("exclude_done"), false);
  assert.deepEqual(lines(r.stdout), ["WEB-1", "INF-4", "WEB-2", "INF-5"]);
});

test("--product narrows to that product, even on a server that ignores the filter", async () => {
  const r = await run(["search", "task link", "--product", "infra", "--quiet"]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(searches()[0].get("product_id"), "2");
  assert.deepEqual(lines(r.stdout), ["INF-4", "INF-5"]);
});

test("an unknown product is an error that lists the products", async () => {
  const r = await run(["search", "task link", "--product", "nope"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /Product 'nope' not found/);
  assert.match(r.stderr, /web/);
  assert.equal(searches().length, 0, "nothing is searched");
});

test("--json prints the rows, and --fields picks what to print", async () => {
  const json = await run(["search", "task link", "--json"]);
  assert.equal(json.code, 0, json.stderr);
  const rows = JSON.parse(json.stdout);
  assert.deepEqual(rows.map((c) => c.key), ["WEB-1", "INF-4", "INF-5"]);
  assert.equal(rows[0].url, "http://x/c/WEB-1");

  const fields = await run(["search", "task link", "--fields", "key,product"]);
  assert.equal(fields.code, 0, fields.stderr);
  const [header, , first] = lines(fields.stdout);
  assert.deepEqual(cells(header), ["key", "product"]);
  assert.deepEqual(cells(first), ["WEB-1", "web"]);
});

test("no text is a usage error", async () => {
  for (const args of [["search"], ["search", "  "]]) {
    const r = await run(args);
    assert.equal(r.code, 1, args.join(" "));
    assert.match(r.stderr, /Usage: agentboard search <text>/);
    assert.equal(searches().length, 0);
  }
});

test("no matches says so and succeeds", async () => {
  const r = await run(["search", "nothing"]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /no results/);
  assert.equal(r.stderr, "");
});

test("a full page of results says more cards may match", async () => {
  const r = await run(["search", "bulk", "--quiet"]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(lines(r.stdout).length, 50);
  assert.match(r.stderr, /first 50 matches/);
  assert.match(r.stderr, /--product/);
});

test("a server without card search says so", async () => {
  const r = await run(["search", "unsupported"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /HTTP 404/);
  assert.match(r.stderr, /no card search/);
});

test("search --help names its flags", async () => {
  const r = await run(["search", "--help"]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /Usage: agentboard search <text>/);
  for (const flag of ["--product", "--include-done", "--fields", "--quiet", "--json"]) {
    assert.match(r.stdout, new RegExp(flag));
  }
});
