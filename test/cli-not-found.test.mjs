// When the CLI can't find the organization, product or board it was given, the
// error must say what it tried, where it looked, and list what does exist, the
// way a missing column already does. Otherwise a typo or a wrong
// AGENTBOARD_BOARD means a second command just to find the right name.
//
//   node --test test/

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../cli/agentboard.js", import.meta.url));

const ORGS = [
  { id: 1, slug: "labs", name: "Labs" },
  { id: 2, slug: "clients", name: "Client Work" },
];

const PRODUCTS = [
  { id: 10, org_id: 1, slug: "general", name: "General", default_board_id: 100 },
  { id: 11, org_id: 1, slug: "openkb", name: "OpenKB", default_board_id: null },
  // A product with no boards at all.
  { id: 12, org_id: 2, slug: "empty", name: "Empty", default_board_id: null },
];

const BOARDS = {
  10: [
    { id: 102, product_id: 10, slug: "ship", name: "Ship", position: 2 },
    { id: 100, product_id: 10, slug: "design", name: "Design", position: 0 },
    { id: 101, product_id: 10, slug: "build", name: "Build", position: 1 },
  ],
  11: [{ id: 110, product_id: 11, slug: "docs", name: "Docs", position: 0 }],
  12: [],
};

/** @type {{ method: string, url: string }[]} */
let requests = [];
let server;
let baseUrl;
// Swap in an empty list to check the "nothing exists" wording.
let orgs = ORGS;
let products = PRODUCTS;

before(async () => {
  server = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      requests.push({ method: req.method, url: req.url });
      res.setHeader("Content-Type", "application/json");
      const boards = /^\/api\/boards\?product_id=(\d+)$/.exec(req.url);
      if (req.method === "GET" && req.url === "/api/orgs") {
        res.end(JSON.stringify(orgs));
      } else if (req.method === "GET" && req.url === "/api/products") {
        res.end(JSON.stringify(products));
      } else if (req.method === "GET" && boards) {
        res.end(JSON.stringify(BOARDS[boards[1]] ?? []));
      } else if (req.method === "GET" && req.url === "/api/columns?board_id=100") {
        res.end(JSON.stringify([
          { id: 1000, board_id: 100, slug: "todo", name: "Todo", position: 0 },
          { id: 1001, board_id: 100, slug: "done", name: "Done", position: 1 },
        ]));
      } else if (req.method === "GET" && req.url === "/api/cards/7") {
        res.end(JSON.stringify({ id: 7, product_id: 10, product_slug: "general", column_slug: "todo" }));
      } else if (req.method === "GET" && req.url === "/api/cards/8") {
        // An older server that says which product but not its slug.
        res.end(JSON.stringify({ id: 8, product_id: 10, column_slug: "todo" }));
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

function run(args, env = {}) {
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
          ...env,
        },
      },
      (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr }),
    );
  });
}

test("an unknown board names the product and lists its boards in board order", async () => {
  const r = await run(["list", "--product", "general", "--board", "development"]);
  assert.notEqual(r.code, 0);
  assert.equal(
    r.stderr.trim(),
    "Error: Board 'development' not found in product 'general'. Available: design (Design), build (Build), ship (Ship)",
  );
  // Nothing was read from or written to a board.
  assert.ok(!requests.some((q) => q.url.startsWith("/api/cards") || q.url.startsWith("/api/columns")));
});

test("an unknown board from AGENTBOARD_BOARD gets the same help", async () => {
  const r = await run(["list"], { AGENTBOARD_PRODUCT: "general", AGENTBOARD_BOARD: "development" });
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /Board 'development' not found in product 'general'\. Available: design \(Design\)/);
});

test("an unknown board on a product with no boards says there are none", async () => {
  const r = await run(["list", "--product", "empty", "--board", "development"]);
  assert.notEqual(r.code, 0);
  assert.equal(r.stderr.trim(), "Error: Board 'development' not found in product 'empty'. It has no boards yet.");
});

test("task move --to-board on the card's own product names that product", async () => {
  const r = await run(["task", "move", "7", "--to-board", "nope", "--column", "todo"]);
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /Board 'nope' not found in product 'general'\. Available: design \(Design\), build \(Build\), ship \(Ship\)/);
  assert.ok(!requests.some((q) => q.method !== "GET"));
});

test("task move --to-board without the product's slug still lists the boards", async () => {
  const r = await run(["task", "move", "8", "--to-board", "nope", "--column", "todo"]);
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /Board 'nope' not found in this product\. Available: design \(Design\), build \(Build\), ship \(Ship\)/);
});

test("task move --to-product --to-board names the product it was given", async () => {
  const r = await run(["task", "move", "8", "--to-product", "openkb", "--to-board", "nope", "--column", "todo"]);
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /Board 'nope' not found in product 'openkb'\. Available: docs \(Docs\)/);
});

test("an unknown column says where it looked and lists the columns", async () => {
  const r = await run(["list", "--product", "general", "--column", "doing"]);
  assert.notEqual(r.code, 0);
  assert.equal(r.stderr.trim(), "Error: Column 'doing' not found in this board. Available: todo (Todo), done (Done)");
});

test("an unknown product lists the products you can see", async () => {
  const r = await run(["list", "--product", "agentbord"]);
  assert.notEqual(r.code, 0);
  assert.equal(
    r.stderr.trim(),
    "Error: Product 'agentbord' not found. Available: general (General), openkb (OpenKB), empty (Empty)",
  );
});

test("an unknown product with none visible says so", async () => {
  products = [];
  try {
    const r = await run(["board", "list", "--product", "general"]);
    assert.notEqual(r.code, 0);
    assert.equal(r.stderr.trim(), "Error: Product 'general' not found. You have no products yet.");
  } finally {
    products = PRODUCTS;
  }
});

test("an unknown organization lists the organizations you can see", async () => {
  const r = await run(["product", "list", "--org", "lab"]);
  assert.notEqual(r.code, 0);
  assert.equal(
    r.stderr.trim(),
    "Error: Organization 'lab' not found. Available: labs (Labs), clients (Client Work)",
  );
});

test("an unknown organization with none visible says so", async () => {
  orgs = [];
  try {
    const r = await run(["product", "list", "--org", "labs"]);
    assert.notEqual(r.code, 0);
    assert.equal(r.stderr.trim(), "Error: Organization 'labs' not found. You have no organizations yet.");
  } finally {
    orgs = ORGS;
  }
});

test("a name that matches still resolves", async () => {
  const r = await run(["board", "list", "--product", "OpenKB", "--json"]);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout).map((b) => b.slug), ["docs"]);
});
