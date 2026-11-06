// Clearing a card's due date from the CLI (AB-114). `task update <id> --due ""`
// said "Provide at least one field", and `--due null` reached the API as the
// text "null" and came back as an HTTP 500, so cards kept stale dates.
// `--due none` (or `null`) now sends null, which clears the date; a date the
// server can't read comes back as its 400, not a 500.
//
//   node --test test/

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../cli/agentboard.js", import.meta.url));

const CARD = { id: 5, key: "AB-5", title: "Five", priority: "medium", due_date: "2026-10-19" };
const PRODUCTS = [{ id: 1, slug: "agentboard", name: "AgentBoard", default_board_id: 11 }];
const BOARDS = [{ id: 11, product_id: 1, slug: "development", name: "Development", position: 0 }];
const COLUMNS = [{ id: 111, board_id: 11, name: "Todo", slug: "todo", position: 0 }];

/** @type {{ method: string, url: string, body: any }[]} */
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
      const send = (status, data) => { res.statusCode = status; res.end(JSON.stringify(data)); };
      if (req.method === "GET" && req.url === "/api/products") return send(200, PRODUCTS);
      if (req.method === "GET" && req.url === "/api/boards?product_id=1") return send(200, BOARDS);
      if (req.method === "GET" && req.url === "/api/columns?board_id=11") return send(200, COLUMNS);
      if (req.method === "POST" && req.url === "/api/cards") return send(201, { ...CARD, id: 6, key: "AB-6", ...body });
      if (req.url === "/api/cards/5" && req.method === "PATCH") {
        // What the API answers for a date it can't read.
        if (body.due_date === "soon") {
          return send(400, { error: 'due_date "soon" is not a date. Use YYYY-MM-DD, like 2026-11-01, or null to clear it' });
        }
        return send(200, { ...CARD, ...body });
      }
      send(404, { error: "Not found" });
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
      {
        env: {
          ...process.env,
          AGENTBOARD_URL: baseUrl, AGENTBOARD_TOKEN: "", AGENTBOARD_AGENT_NAME: "",
          AGENTBOARD_PRODUCT: "", AGENTBOARD_BOARD: "",
        },
      },
      (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr }),
    );
  });
}

const patches = () => requests.filter((r) => r.method === "PATCH");

test("task update --due none clears the due date", async () => {
  for (const word of ["none", "None", "NONE", "null"]) {
    const r = await run("task", "update", "5", "--due", word, "--json");
    assert.equal(r.code, 0, `${word}: ${r.stderr}`);
    assert.deepEqual(patches(), [{ method: "PATCH", url: "/api/cards/5", body: { due_date: null } }], word);
    assert.equal(JSON.parse(r.stdout).due_date, null);
  }
});

test("task update --due=none works in the inline form too", async () => {
  const r = await run("task", "update", "5", "--due=none", "--quiet");
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(patches().map((p) => p.body), [{ due_date: null }]);
});

test("task update --due <date> still sends the date as given", async () => {
  const r = await run("task", "update", "5", "--due", "2026-11-01", "--quiet");
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(patches().map((p) => p.body), [{ due_date: "2026-11-01" }]);
});

test("task update --due \"\" on its own says how to clear the date", async () => {
  const r = await run("task", "update", "5", "--due", "");
  assert.notEqual(r.code, 0);
  assert.deepEqual(requests, [], "nothing reaches the server");
  assert.match(r.stderr, /--due none/);
});

test("task update --due \"\" next to another field leaves the date alone, as before", async () => {
  const r = await run("task", "update", "5", "--priority", "high", "--due", "", "--quiet");
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(patches().map((p) => p.body), [{ priority: "high" }]);
});

test("a date the server can't read is its 400, with the message, and a failing exit", async () => {
  const r = await run("task", "update", "5", "--due", "soon");
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /HTTP 400: due_date "soon" is not a date/);
  assert.equal(r.stdout, "");
});

test("new --due none makes a card with no due date", async () => {
  const r = await run("new", "No date", "--product", "agentboard", "--board", "development", "--due", "none", "--json");
  assert.equal(r.code, 0, r.stderr);
  const post = requests.find((q) => q.method === "POST");
  assert.ok(post, "the card was created");
  assert.equal("due_date" in post.body, false, JSON.stringify(post.body));
});

test("task update --help says how to clear the due date", async () => {
  const r = await run("task", "update", "--help");
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /--due <date>.*none clears/);
});
