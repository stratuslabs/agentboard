// The CLI names cards by their keys (AB-105), the way the web app does, so
// what an agent copies out of it is something a person can find: `show`
// leads with key and link, the card tables lead with a key column, and
// --quiet prints keys. A card without a key (a server from before keys) falls
// back to its id. Every command that takes a card takes a key, including
// `task reorder --ids`.
//
//   node --test test/

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../cli/agentboard.js", import.meta.url));

const PRODUCTS = [{ id: 16, slug: "agentboard", name: "AgentBoard", key: "AB", default_board_id: 61 }];
const BOARDS = { 16: [{ id: 61, product_id: 16, slug: "development", name: "Development", position: 0 }] };
const COLUMNS = {
  61: [
    { id: 302, board_id: 61, slug: "todo", name: "Todo", position: 0 },
    { id: 303, board_id: 61, slug: "in-progress", name: "In Progress", position: 1 },
    { id: 305, board_id: 61, slug: "done", name: "Done", position: 2 },
  ],
};

let base;
const card = (id, number, title, extra = {}) => ({
  id, number, key: `AB-${number}`, product_key: "AB", title, column_id: 302, assignee_name: "Remy",
  priority: "high", url: `${base}/c/AB-${number}`, ...extra,
});
const CARDS = () => [card(1340, 105, "Lead with keys"), card(1341, 106, "Second card", { priority: "low" })];
// /api/cards/views sends cards.* plus product_key, and no key.
const ASSIGNED = () => [
  {
    id: 1340, number: 105, product_key: "AB", title: "Lead with keys", column_id: 302, priority: "high",
    product_slug: "agentboard", product_name: "AgentBoard", board_slug: "development", board_name: "Development",
    column_name: "Todo",
  },
];
const MEMBERS = [{ id: 49, name: "Remy", type: "agent" }];

let requests = [];
let server;

before(async () => {
  server = http.createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    requests.push({ method: req.method, url: req.url, body: raw ? JSON.parse(raw) : undefined });
    res.setHeader("Content-Type", "application/json");
    const u = new URL(req.url, "http://x");
    const send = (data, status = 200) => {
      res.statusCode = status;
      res.end(JSON.stringify(data));
    };
    const one = /^\/api\/cards\/([^/]+)$/.exec(u.pathname);
    if (u.pathname === "/api/products") return send(PRODUCTS);
    if (u.pathname === "/api/boards") return send(BOARDS[u.searchParams.get("product_id")] ?? []);
    if (u.pathname === "/api/columns") return send(COLUMNS[u.searchParams.get("board_id")] ?? []);
    if (u.pathname === "/api/members") return send(MEMBERS);
    if (u.pathname === "/api/cards/views") return send(ASSIGNED());
    if (u.pathname === "/api/cards/reorder" && req.method === "PATCH") return send({ ok: true });
    if (u.pathname === "/api/cards" && req.method === "POST") {
      return send(card(1342, 107, "Created", { column_id: 302 }), 201);
    }
    if (u.pathname === "/api/cards") return send(u.searchParams.get("assignee") ? [] : CARDS());
    if (u.pathname.startsWith("/api/columns/by-card/")) return send(COLUMNS[61]);
    if (/^\/api\/cards\/[^/]+\/move$/.test(u.pathname)) {
      return send(card(1340, 105, "Lead with keys", { column_id: 305 }));
    }
    if (one) {
      const ref = decodeURIComponent(one[1]).toUpperCase();
      const found = CARDS().find((c) => String(c.id) === ref || c.key === ref);
      if (!found) return send({ error: "Not found" }, 404);
      if (req.method === "PATCH") return send({ ...found, ...requests.at(-1).body });
      return send(found);
    }
    send({ error: "Not found" }, 404);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((r) => server.close(r)));

function run(...args) {
  requests = [];
  const env = { ...process.env, AGENTBOARD_URL: base, AGENTBOARD_TOKEN: "", AGENTBOARD_AGENT_NAME: "Remy" };
  delete env.AGENTBOARD_PRODUCT;
  delete env.AGENTBOARD_BOARD;
  return new Promise((resolve) => {
    execFile(process.execPath, [CLI, ...args], { env }, (err, stdout, stderr) =>
      resolve({ code: err ? err.code : 0, stdout, stderr }),
    );
  });
}

const lines = (s) => s.split("\n").filter((l) => l.length > 0);
const cells = (line) => line.trim().split(/\s{2,}/);
const firstWords = (s) => lines(s).map((l) => l.split(/\s+/)[0]);

for (const cmd of [["show"], ["task", "show"]]) {
  const name = cmd.join(" ");

  test(`${name} leads with the key and the link, and the id comes after`, async () => {
    const r = await run(...cmd, "AB-105");
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(firstWords(r.stdout).slice(0, 3), ["key", "url", "id"]);
    assert.match(r.stdout, /^key\s+AB-105$/m);
    assert.match(r.stdout, new RegExp(`^url\\s+${base}/c/AB-105$`, "m"));
  });

  test(`${name} --quiet prints the key`, async () => {
    const r = await run(...cmd, "1340", "--quiet");
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout, "AB-105\n");
  });
}

test("list's table starts with the key and has no id column", async () => {
  const r = await run("list", "--product", "agentboard");
  assert.equal(r.code, 0, r.stderr);
  const [, header, , ...rows] = lines(r.stdout);
  assert.deepEqual(cells(header), ["key", "title", "column", "assignee", "priority"]);
  assert.deepEqual(rows.map((row) => cells(row)[0]), ["AB-105", "AB-106"]);
  assert.doesNotMatch(r.stdout, /\b1340\b/);
});

test("list and task list --quiet print keys", async () => {
  for (const args of [["list"], ["task", "list"]]) {
    const r = await run(...args, "--product", "agentboard", "--quiet");
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout, "AB-105\nAB-106\n", args.join(" "));
  }
});

test("my-tasks builds the key from the product key and number the view sends", async () => {
  const r = await run("my-tasks");
  assert.equal(r.code, 0, r.stderr);
  const [header, , row] = lines(r.stdout);
  assert.deepEqual(cells(header), ["key", "title", "product", "board", "column", "priority"]);
  assert.deepEqual(cells(row), ["AB-105", "Lead with keys", "agentboard", "development", "Todo", "high"]);

  const quiet = await run("my-tasks", "--quiet");
  assert.equal(quiet.stdout, "AB-105\n");
});

test("--fields key works in tables and JSON", async () => {
  const r = await run("my-tasks", "--fields", "key,title", "--json");
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), [{ key: "AB-105", title: "Lead with keys" }]);
});

test("new prints the new card's key first, and --quiet prints only the key", async () => {
  const r = await run("task", "add", "Created", "--product", "agentboard");
  assert.equal(r.code, 0, r.stderr);
  assert.match(lines(r.stdout)[0], /^Created AB-107 on agentboard\/development in Todo$/);

  // The card printed under that line starts with its key and link too.
  assert.deepEqual(firstWords(r.stdout).slice(1, 4), ["key", "url", "id"]);

  const quiet = await run("task", "add", "Created", "--product", "agentboard", "--quiet");
  assert.equal(quiet.stdout, "AB-107\n");
});

test("task list's every-field table and update's output start with key, url and id", async () => {
  const list = await run("task", "list", "--product", "agentboard");
  assert.equal(list.code, 0, list.stderr);
  const [, header] = lines(list.stdout);
  assert.deepEqual(header.trim().split(/\s+/).slice(0, 3), ["key", "url", "id"]);

  const update = await run("task", "update", "AB-105", "--priority", "low");
  assert.equal(update.code, 0, update.stderr);
  assert.deepEqual(firstWords(update.stdout).slice(0, 3), ["key", "url", "id"]);

  // --json stays as the server sent it.
  const json = await run("task", "update", "AB-105", "--priority", "low", "--json");
  assert.equal(Object.keys(JSON.parse(json.stdout))[0], "id");
});

test("update, status and move --quiet print the card's key, whatever reference was passed", async () => {
  const update = await run("task", "update", "1340", "--priority", "low", "--quiet");
  assert.equal(update.code, 0, update.stderr);
  assert.equal(update.stdout, "AB-105\n");

  const status = await run("status", "1340", "done", "--quiet");
  assert.equal(status.code, 0, status.stderr);
  assert.equal(status.stdout, "AB-105\n");

  const several = await run("status", "1340", "AB-105", "done");
  assert.equal(several.code, 0, several.stderr);
  assert.deepEqual(lines(several.stdout), ["Moved AB-105 to Done", "Moved AB-105 to Done"]);
});

test("task reorder --ids takes keys and sends the cards' ids", async () => {
  const r = await run("task", "reorder", "--ids", "ab-106, 1340");
  assert.equal(r.code, 0, r.stderr);
  const patch = requests.find((q) => q.method === "PATCH" && q.url === "/api/cards/reorder");
  assert.ok(patch, "the reorder was sent");
  assert.deepEqual(patch.body, { ids: [1341, 1340] });
});

test("task reorder --ids refuses a key that matches no card, and moves nothing", async () => {
  const unknown = await run("task", "reorder", "--ids", "AB-106,AB-999");
  assert.notEqual(unknown.code, 0);
  assert.match(unknown.stderr, /AB-999/);
  assert.ok(!requests.some((q) => q.url === "/api/cards/reorder"), "nothing was reordered");

  const junk = await run("task", "reorder", "--ids", "1340,not a card");
  assert.notEqual(junk.code, 0);
  assert.match(junk.stderr, /not a card/);
  assert.ok(!requests.some((q) => q.url === "/api/cards/reorder"));
});
