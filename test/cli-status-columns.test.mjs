// `agentboard status <id> <status>` finds the column by slug. When a board has
// no column with that slug (say Todo was renamed "Can't replicate"), the CLI
// must refuse, exit nonzero, move nothing, and show what the board does have.
//
//   node --test test/

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../cli/agentboard.js", import.meta.url));

const COLUMNS = [
  { id: 11, board_id: 5, name: "Backlog", slug: "backlog", position: 0 },
  { id: 12, board_id: 5, name: "Can't replicate", slug: "can-t-replicate", position: 1 },
  { id: 13, board_id: 5, name: "Done", slug: "done", position: 2 },
];

// Board for card 8: a column renamed "Doing" owns the slug `doing`, next to a
// real `in-progress` column. Board 6 is the same board seen via --column.
const ALIAS_COLUMNS = [
  { id: 21, board_id: 6, name: "Doing", slug: "doing", position: 0 },
  { id: 22, board_id: 6, name: "In Progress", slug: "in-progress", position: 1 },
  { id: 23, board_id: 6, name: "QA", slug: "qa", position: 2 },
];
// Board for card 9: only the legacy slugs, so aliases must still resolve.
const LEGACY_COLUMNS = [
  { id: 31, board_id: 7, name: "In Progress", slug: "in-progress", position: 0 },
  { id: 32, board_id: 7, name: "In Review", slug: "in-review", position: 1 },
];

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
      if (req.method === "GET" && req.url === "/api/columns/by-card/7") {
        res.end(JSON.stringify(COLUMNS));
      } else if (req.method === "GET" && req.url === "/api/columns/by-card/8") {
        res.end(JSON.stringify(ALIAS_COLUMNS));
      } else if (req.method === "GET" && req.url === "/api/columns/by-card/9") {
        res.end(JSON.stringify(LEGACY_COLUMNS));
      } else if (req.method === "GET" && req.url === "/api/products") {
        res.end(JSON.stringify([{ id: 1, slug: "p", name: "P" }]));
      } else if (req.method === "GET" && req.url === "/api/boards?product_id=1") {
        res.end(JSON.stringify([{ id: 6, slug: "b", name: "B" }]));
      } else if (req.method === "GET" && req.url === "/api/columns?board_id=6") {
        res.end(JSON.stringify(ALIAS_COLUMNS));
      } else if (req.method === "GET" && req.url.startsWith("/api/cards?")) {
        res.end(JSON.stringify([]));
      } else if (req.method === "PATCH" && /^\/api\/cards\/[789]\/move$/.test(req.url)) {
        res.end(JSON.stringify({ id: 7, column_id: body.column_id }));
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

function run(...args) {
  requests = [];
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [CLI, ...args],
      { env: { ...process.env, AGENTBOARD_URL: baseUrl, AGENTBOARD_TOKEN: "", AGENTBOARD_AGENT_NAME: "" } },
      (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr }),
    );
  });
}

test("status to a slug the board no longer has moves nothing and lists the columns", async () => {
  const r = await run("status", "7", "todo");
  assert.notEqual(r.code, 0);
  assert.deepEqual(requests.map((q) => `${q.method} ${q.url}`), ["GET /api/columns/by-card/7"]);
  assert.match(r.stderr, /'todo'/);
  assert.match(r.stderr, /Available: backlog \(Backlog\), can-t-replicate \(Can't replicate\), done \(Done\)/);
});

test("status to a slug the board has still moves the card", async () => {
  const r = await run("status", "7", "done");
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(requests.at(-1), { method: "PATCH", url: "/api/cards/7/move", body: { column_id: 13 } });
});

test("status prefers a column whose slug is exactly the alias word", async () => {
  const r = await run("status", "8", "doing");
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(requests.at(-1), { method: "PATCH", url: "/api/cards/8/move", body: { column_id: 21 } });
});

test("status accepts any slug the board has, not only the built-in names", async () => {
  const r = await run("status", "8", "qa");
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(requests.at(-1), { method: "PATCH", url: "/api/cards/8/move", body: { column_id: 23 } });
});

test("status still maps legacy aliases when no column has that slug", async () => {
  const r = await run("status", "9", "review");
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(requests.at(-1), { method: "PATCH", url: "/api/cards/9/move", body: { column_id: 32 } });
});

test("list --column prefers the exact slug over the alias", async () => {
  const r = await run("list", "--product", "p", "--board", "b", "--column", "doing", "--include-done");
  assert.equal(r.code, 0, r.stderr);
  assert.match(requests.at(-1).url, /column_id=21/);
});
