// Column lookup in the CLI ignores case. A column named "Inbox" keeps the slug
// `backlog` when it is renamed, so `--column inbox` must reach it the same way
// `--column Inbox` and `--column backlog` do. An exact match still wins, and a
// name that only matches several columns case-insensitively moves nothing.
//
//   node --test test/

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../cli/agentboard.js", import.meta.url));

// Board 6: a renamed Backlog, plus the usual columns.
const COLUMNS = [
  { id: 41, board_id: 6, name: "Inbox", slug: "backlog", position: 0 },
  { id: 42, board_id: 6, name: "Todo", slug: "todo", position: 1 },
  { id: 43, board_id: 6, name: "In Progress", slug: "in-progress", position: 2 },
  { id: 44, board_id: 6, name: "In Review", slug: "in-review", position: 3 },
  { id: 45, board_id: 6, name: "Done", slug: "done", position: 4 },
];

// Card 8's board: two columns whose names differ only by case.
const TWIN_COLUMNS = [
  { id: 51, board_id: 7, name: "Review", slug: "review", position: 0 },
  { id: 52, board_id: 7, name: "review", slug: "review-2", position: 1 },
  { id: 53, board_id: 7, name: "Done", slug: "done", position: 2 },
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
        res.end(JSON.stringify(TWIN_COLUMNS));
      } else if (req.method === "GET" && req.url === "/api/cards/7") {
        res.end(JSON.stringify({ id: 7, board_id: 6, product_id: 1, column_slug: "todo" }));
      } else if (req.method === "GET" && req.url === "/api/products") {
        res.end(JSON.stringify([{ id: 1, slug: "p", name: "P" }]));
      } else if (req.method === "GET" && req.url === "/api/boards?product_id=1") {
        res.end(JSON.stringify([{ id: 6, slug: "b", name: "B" }]));
      } else if (req.method === "GET" && req.url === "/api/columns?board_id=6") {
        res.end(JSON.stringify(COLUMNS));
      } else if (req.method === "GET" && req.url.startsWith("/api/cards?")) {
        res.end(JSON.stringify([]));
      } else if (req.method === "PATCH" && /^\/api\/cards\/[78]\/move$/.test(req.url)) {
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

const moved = () => requests.filter((q) => q.method === "PATCH");

for (const word of ["inbox", "INBOX", "Inbox", "backlog", "Backlog"]) {
  test(`list --column ${word} finds the column named Inbox (slug backlog)`, async () => {
    const r = await run("list", "--product", "p", "--board", "b", "--column", word, "--include-done");
    assert.equal(r.code, 0, r.stderr);
    assert.match(requests.at(-1).url, /column_id=41/);
  });
}

for (const [word, id] of [
  ["inbox", 41],
  ["in review", 44],
  ["IN-PROGRESS", 43],
  ["DONE", 45],
  ["Todo", 42],
]) {
  test(`status <id> '${word}' moves the card to column ${id}`, async () => {
    const r = await run("status", "7", word);
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(moved(), [{ method: "PATCH", url: "/api/cards/7/move", body: { column_id: id } }]);
  });
}

test("legacy aliases ignore case too (WIP -> in-progress)", async () => {
  const r = await run("status", "7", "WIP");
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(moved(), [{ method: "PATCH", url: "/api/cards/7/move", body: { column_id: 43 } }]);
});

test("task move --column ignores case", async () => {
  const r = await run("task", "move", "7", "--column", "inbox");
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(moved(), [{ method: "PATCH", url: "/api/cards/7/move", body: { column_id: 41 } }]);
});

test("an exact name still wins over a case-insensitive twin", async () => {
  const r = await run("status", "8", "review");
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(moved(), [{ method: "PATCH", url: "/api/cards/8/move", body: { column_id: 51 } }]);

  const r2 = await run("status", "8", "Review");
  assert.equal(r2.code, 0, r2.stderr);
  assert.deepEqual(moved(), [{ method: "PATCH", url: "/api/cards/8/move", body: { column_id: 51 } }]);
});

test("a name matching two columns only case-insensitively moves nothing", async () => {
  const r = await run("status", "8", "REVIEW");
  assert.notEqual(r.code, 0);
  assert.deepEqual(moved(), []);
  assert.match(r.stderr, /'REVIEW' matches more than one column: review \(Review\), review-2 \(review\)/);
});

// The ambiguity error has to point at something that resolves to the column
// you meant. An exact name can't: the second column's name, "review", is the
// first column's slug, and exact slugs win. Slugs are unique per board.
test("the ambiguity error suggests slugs, and each slug reaches its own column", async () => {
  const r = await run("status", "8", "REVIEW");
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /Use one of these slugs: review, review-2\./);
  assert.doesNotMatch(r.stderr, /exact name/);

  for (const [slug, id] of [["review", 51], ["review-2", 52]]) {
    const ok = await run("status", "8", slug);
    assert.equal(ok.code, 0, ok.stderr);
    assert.deepEqual(moved(), [{ method: "PATCH", url: "/api/cards/8/move", body: { column_id: id } }]);
  }
});

test("an unknown column is still refused", async () => {
  const r = await run("status", "7", "nope");
  assert.notEqual(r.code, 0);
  assert.deepEqual(moved(), []);
});
