// `agentboard status 1 2 3 todo` moves several cards in one call (card 833).
// Each card is moved on its own: one that fails doesn't stop the rest, every
// card gets a line saying what happened, and the exit code is 1 when any move
// failed. `task move 1 2 3 --column todo` does the same.
//
//   node --test test/

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../cli/agentboard.js", import.meta.url));

// Cards 1-3 and 6 live on board 5, which has a Todo column.
const BOARD_5 = [
  { id: 101, board_id: 5, name: "Backlog", slug: "backlog", position: 0 },
  { id: 102, board_id: 5, name: "Todo", slug: "todo", position: 1 },
  { id: 103, board_id: 5, name: "Done", slug: "done", position: 2 },
];
// Card 4 lives on board 6, which has no Todo column.
const BOARD_6 = [
  { id: 201, board_id: 6, name: "Ideas", slug: "ideas", position: 0 },
  { id: 202, board_id: 6, name: "Shipped", slug: "shipped", position: 1 },
];
// Card 7 lives on board 7, where "todo" matches two columns that differ only by case.
const BOARD_7 = [
  { id: 301, board_id: 7, name: "ToDo", slug: "to-do", position: 0 },
  { id: 302, board_id: 7, name: "TODO", slug: "todo-2", position: 1 },
];
const BOARD_OF = { 1: BOARD_5, 2: BOARD_5, 3: BOARD_5, 4: BOARD_6, 6: BOARD_5, 7: BOARD_7 };
// Card 5 doesn't exist. Card 6's move fails on the server.

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
      let m;
      if (req.method === "GET" && (m = req.url.match(/^\/api\/columns\/by-card\/(\d+)$/)) && BOARD_OF[m[1]]) {
        res.end(JSON.stringify(BOARD_OF[m[1]]));
      } else if (req.method === "GET" && (m = req.url.match(/^\/api\/cards\/(\d+)$/)) && BOARD_OF[m[1]]) {
        const cols = BOARD_OF[m[1]];
        res.end(JSON.stringify({
          id: Number(m[1]), title: `Card ${m[1]}`, column_id: cols[0].id, column_slug: cols[0].slug,
          board_id: cols[0].board_id, product_id: 1, product_slug: "p",
        }));
      } else if (req.method === "PATCH" && (m = req.url.match(/^\/api\/cards\/(\d+)\/move$/))) {
        if (m[1] === "6") {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: "database is down" }));
        } else {
          res.end(JSON.stringify({ id: Number(m[1]), title: `Card ${m[1]}`, column_id: body.column_id }));
        }
      } else {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: "Card not found" }));
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

const moves = () =>
  requests.filter((q) => q.method === "PATCH").map((q) => `${q.url} -> ${q.body.column_id}`);
const lines = (text) => text.split("\n").filter(Boolean);

test("status moves every card listed and prints one line per card", async () => {
  const r = await run("status", "1", "2", "3", "todo");
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(moves(), [
    "/api/cards/1/move -> 102",
    "/api/cards/2/move -> 102",
    "/api/cards/3/move -> 102",
  ]);
  assert.deepEqual(lines(r.stdout), ["Moved 1 to Todo", "Moved 2 to Todo", "Moved 3 to Todo"]);
  assert.equal(r.stderr, "");
});

test("a card whose board lacks the column fails alone; the rest still move and the exit is 1", async () => {
  const r = await run("status", "1", "4", "2", "todo");
  assert.equal(r.code, 1);
  assert.deepEqual(moves(), ["/api/cards/1/move -> 102", "/api/cards/2/move -> 102"]);
  assert.deepEqual(lines(r.stdout), ["Moved 1 to Todo", "Moved 2 to Todo"]);
  assert.match(r.stderr, /^Error: 4: Column 'todo' not found on this board\. Available: ideas \(Ideas\), shipped \(Shipped\)$/m);
  assert.match(r.stderr, /Moved 2 of 3 cards; 1 failed: 4/);
});

test("HTTP errors on one card (missing card, failed move) don't stop the others", async () => {
  const r = await run("status", "5", "6", "3", "done");
  assert.equal(r.code, 1);
  assert.deepEqual(moves(), ["/api/cards/6/move -> 103", "/api/cards/3/move -> 103"]);
  assert.deepEqual(lines(r.stdout), ["Moved 3 to Done"]);
  assert.match(r.stderr, /^Error: 5: HTTP 404: Card not found$/m);
  assert.match(r.stderr, /^Error: 6: HTTP 500: database is down$/m);
  assert.match(r.stderr, /Moved 1 of 3 cards; 2 failed: 5, 6/);
});

test("--json prints one result per card and still exits 1 when any failed", async () => {
  const r = await run("status", "1", "4", "todo", "--json");
  assert.equal(r.code, 1);
  const out = JSON.parse(r.stdout);
  assert.equal(out.length, 2);
  assert.deepEqual(
    out.map((x) => ({ id: x.id, ok: x.ok, column: x.column })),
    [{ id: "1", ok: true, column: "todo" }, { id: "4", ok: false, column: undefined }],
  );
  assert.equal(out[0].card.column_id, 102);
  assert.match(out[1].error, /Column 'todo' not found/);
});

test("--quiet prints only the ids that moved", async () => {
  const r = await run("status", "1", "5", "2", "todo", "--quiet");
  assert.equal(r.code, 1);
  assert.deepEqual(lines(r.stdout), ["1", "2"]);
  assert.match(r.stderr, /^Error: 5: /m);
});

test("a single id keeps the old output: the moved card, and exit 1 on failure", async () => {
  const ok = await run("status", "1", "todo");
  assert.equal(ok.code, 0, ok.stderr);
  assert.match(ok.stdout, /^column_id\s+102$/m);

  const bad = await run("status", "5", "todo");
  assert.equal(bad.code, 1);
  assert.equal(bad.stderr, "Error: HTTP 404: Card not found\n");
});

test("task move takes several ids with --column", async () => {
  const r = await run("task", "move", "1", "4", "3", "--column", "done");
  assert.equal(r.code, 1);
  assert.deepEqual(moves(), ["/api/cards/1/move -> 103", "/api/cards/3/move -> 103"]);
  assert.deepEqual(lines(r.stdout), ["Moved 1 to Done", "Moved 3 to Done"]);
  assert.match(r.stderr, /^Error: 4: Column 'done' not found on this board\./m);
  assert.match(r.stderr, /Moved 2 of 3 cards; 1 failed: 4/);
});

test("status with no column still prints usage", async () => {
  const r = await run("status", "1");
  assert.equal(r.code, 1);
  assert.match(r.stderr, /Usage: agentboard status <id> \[<id> \.\.\.\] <column>/);
});

test("task move refuses several ids with --to-board and moves nothing", async () => {
  const r = await run("task", "move", "1", "2", "--to-board", "other", "--column", "todo");
  assert.equal(r.code, 1);
  assert.deepEqual(requests, []);
  assert.match(r.stderr, /several cards to another board isn't supported/);
});

test("an ambiguous column on one card is that card's failure, not the end of the batch (#95 review)", async () => {
  const { code, stdout, stderr } = await run("status", "7", "1", "todo", "--json");
  assert.equal(code, 1);
  const results = JSON.parse(stdout);
  assert.deepEqual(results.map((r) => [r.id, r.ok]), [["7", false], ["1", true]]);
  assert.match(results[0].error, /matches more than one column/);
  assert.match(stderr, /7: Column 'todo' matches more than one column/);
});
