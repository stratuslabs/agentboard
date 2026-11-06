// `task move <id> --before <id>` / `--after <id>` puts cards next to another
// card, the way a drag on the board does (AB-112). Before this the CLI could
// only reorder a whole column with `task reorder --ids`, and a partial list
// collided with the positions of the cards it left out.
//
// The fake server keeps real state: positions per column, the move route and
// the reorder route, so each test reads the order a board would show (by
// position, then id, as GET /api/cards sorts) instead of the requests sent.
//
//   node --test test/

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../cli/agentboard.js", import.meta.url));

// Board 5 (product 1, AB): Backlog 101, Todo 102. Board 6 (product 1): Ideas 201.
const COLUMNS = {
  101: { id: 101, board_id: 5, slug: "backlog", name: "Backlog" },
  102: { id: 102, board_id: 5, slug: "todo", name: "Todo" },
  201: { id: 201, board_id: 6, slug: "ideas", name: "Ideas" },
};
const BOARD_SLUG = { 5: "development", 6: "research" };

/** @type {Map<number, { id: number, number: number, title: string, column_id: number, position: number }>} */
let cards;
/** @type {{ method: string, url: string, body: unknown }[]} */
let requests = [];
let failReorder = false;
let server;
let baseUrl;

function reset() {
  cards = new Map();
  const add = (id, column_id, position) =>
    cards.set(id, { id, number: id, title: `Card ${id}`, column_id, position });
  // Todo: AB-1, AB-2, AB-3, AB-4. Positions as the board leaves them.
  add(1, 102, 0);
  add(2, 102, 1);
  add(3, 102, 2);
  add(4, 102, 3);
  // Backlog: AB-9. Ideas, on another board: AB-20.
  add(9, 101, 0);
  add(20, 201, 0);
  failReorder = false;
}

function withLocation(card) {
  const col = COLUMNS[card.column_id];
  return {
    ...card,
    key: `AB-${card.number}`,
    column_slug: col.slug,
    column_name: col.name,
    board_id: col.board_id,
    board_slug: BOARD_SLUG[col.board_id],
    product_id: 1,
    product_slug: "agentboard",
    product_key: "AB",
  };
}

function cardFor(ref) {
  const m = String(ref).match(/^(?:ab-)?(\d+)$/i);
  return m ? cards.get(Number(m[1])) : undefined;
}

const byBoardOrder = (a, b) => a.position - b.position || a.id - b.id;

/** The keys in a column, in the order the board shows them. */
function order(columnId) {
  return [...cards.values()]
    .filter((c) => c.column_id === columnId)
    .sort(byBoardOrder)
    .map((c) => `AB-${c.number}`);
}

before(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : undefined;
      requests.push({ method: req.method, url: req.url, body });
      res.setHeader("Content-Type", "application/json");
      const url = new URL(req.url, "http://x");
      const send = (status, data) => {
        res.statusCode = status;
        res.end(JSON.stringify(data));
      };
      let m;
      if (req.method === "GET" && url.pathname === "/api/cards") {
        const columnId = Number(url.searchParams.get("column_id"));
        const rows = [...cards.values()]
          .filter((c) => !columnId || c.column_id === columnId)
          .sort(byBoardOrder)
          .map(withLocation);
        send(200, rows);
      } else if (req.method === "GET" && (m = url.pathname.match(/^\/api\/cards\/([^/]+)$/))) {
        const card = cardFor(decodeURIComponent(m[1]));
        if (card) send(200, withLocation(card));
        else send(404, { error: "Not found" });
      } else if (req.method === "PATCH" && (m = url.pathname.match(/^\/api\/cards\/(\d+)\/move$/))) {
        const card = cardFor(m[1]);
        if (!card) return send(404, { error: "Not found" });
        if (!COLUMNS[body.column_id]) return send(404, { error: "Column not found" });
        card.column_id = body.column_id;
        card.position = body.position ?? 999;
        send(200, withLocation(card));
      } else if (req.method === "PATCH" && url.pathname === "/api/cards/reorder") {
        if (failReorder) return send(500, { error: "database is down" });
        body.ids.forEach((id, i) => {
          const card = cards.get(id);
          if (card) card.position = i;
        });
        send(200, { ok: true });
      } else {
        send(404, { error: "Not found" });
      }
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((r) => server.close(r)));

beforeEach(reset);

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

const writes = () => requests.filter((q) => q.method !== "GET");

test("--before puts the card directly above another card in its column", async () => {
  const r = await run("task", "move", "AB-4", "--before", "AB-2");
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(order(102), ["AB-1", "AB-4", "AB-2", "AB-3"]);
  assert.match(r.stdout, /AB-4/);
});

test("--after puts the card directly below another card", async () => {
  const r = await run("task", "move", "AB-1", "--after", "AB-3");
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(order(102), ["AB-2", "AB-3", "AB-1", "AB-4"]);
});

test("--after the last card puts it at the bottom, --before the first at the top", async () => {
  assert.equal((await run("task", "move", "AB-2", "--after", "AB-4")).code, 0);
  assert.deepEqual(order(102), ["AB-1", "AB-3", "AB-4", "AB-2"]);
  assert.equal((await run("task", "move", "ab-4", "--before", "ab-1")).code, 0);
  assert.deepEqual(order(102), ["AB-4", "AB-1", "AB-3", "AB-2"]);
});

test("plain ids work as well as keys", async () => {
  const r = await run("task", "move", "3", "--before", "1");
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(order(102), ["AB-3", "AB-1", "AB-2", "AB-4"]);
});

test("a card from another column on the same board moves into the anchor's column", async () => {
  const r = await run("task", "move", "AB-9", "--before", "AB-3");
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(order(102), ["AB-1", "AB-2", "AB-9", "AB-3", "AB-4"]);
  assert.deepEqual(order(101), []);
  // The printed card is where it landed.
  assert.match(r.stdout, /todo/);
});

test("several cards go in together, in the order given", async () => {
  const r = await run("task", "move", "AB-4", "AB-9", "AB-2", "--before", "AB-1");
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(order(102), ["AB-4", "AB-9", "AB-2", "AB-1", "AB-3"]);
  assert.match(r.stdout, /AB-4, AB-9, AB-2/);
});

test("positions that collide (cards added without a drag) still give the asked order", async () => {
  for (const c of cards.values()) if (c.column_id === 102) c.position = 0;
  const r = await run("task", "move", "AB-1", "--after", "AB-3");
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(order(102), ["AB-2", "AB-3", "AB-1", "AB-4"]);
  // Every card in the column got its own position, as a drag leaves them.
  const positions = [...cards.values()].filter((c) => c.column_id === 102).map((c) => c.position);
  assert.equal(new Set(positions).size, positions.length);
});

test("running the same move twice changes nothing the second time", async () => {
  await run("task", "move", "AB-4", "--before", "AB-2");
  const once = order(102);
  const r = await run("task", "move", "AB-4", "--before", "AB-2");
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(order(102), once);
});

test("--json prints the moved card with its new position; several cards print a list", async () => {
  const one = await run("task", "move", "AB-4", "--before", "AB-1", "--json");
  assert.equal(one.code, 0, one.stderr);
  const card = JSON.parse(one.stdout);
  assert.equal(card.id, 4);
  assert.equal(card.position, 0);
  const many = await run("task", "move", "AB-3", "AB-2", "--after", "AB-1", "--json");
  assert.equal(many.code, 0, many.stderr);
  assert.deepEqual(JSON.parse(many.stdout).map((c) => c.id), [3, 2]);
});

test("--quiet prints the moved keys", async () => {
  const r = await run("task", "move", "AB-3", "AB-2", "--before", "AB-1", "--quiet");
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.stdout.split("\n").filter(Boolean), ["AB-3", "AB-2"]);
});

// ---- Refusals: each exits 1 and writes nothing -------------------------------

async function refused(args, pattern) {
  const before = order(102).join();
  const r = await run(...args);
  assert.equal(r.code, 1, `expected exit 1, got ${r.code}: ${r.stdout}${r.stderr}`);
  assert.match(r.stderr, pattern);
  assert.deepEqual(writes(), [], "nothing should be written");
  assert.equal(order(102).join(), before);
}

test("--before and --after together are refused", async () => {
  await refused(["task", "move", "AB-4", "--before", "AB-1", "--after", "AB-2"], /--before or --after, not both/);
});

test("placing a card next to itself is refused", async () => {
  await refused(["task", "move", "AB-2", "--before", "ab-2"], /next to itself/);
  await refused(["task", "move", "AB-1", "2", "--after", "AB-2"], /next to itself/);
});

test("an anchor that isn't a card is refused before anything moves", async () => {
  await refused(["task", "move", "AB-4", "--before", "AB-77"], /AB-77.*nothing was moved/);
});

test("a moving card that isn't a card stops the move before anything changes", async () => {
  await refused(["task", "move", "AB-4", "AB-78", "--before", "AB-1"], /AB-78.*nothing was moved/);
});

test("an anchor on another board is refused, pointing at --to-board", async () => {
  await refused(["task", "move", "AB-4", "--before", "AB-20"], /another board.*--to-board/);
});

test("--column or --to-board alongside --before is refused", async () => {
  await refused(["task", "move", "AB-4", "--before", "AB-1", "--column", "todo"], /--before.*--column/);
  await refused(["task", "move", "AB-4", "--after", "AB-1", "--to-board", "research"], /--after.*--to-board/);
});

test("a failed reorder exits 1 with the server's error", async () => {
  failReorder = true;
  const r = await run("task", "move", "AB-4", "--before", "AB-1");
  assert.equal(r.code, 1);
  assert.match(r.stderr, /database is down/);
});

test("task move --help describes --before and --after", async () => {
  const r = await run("task", "move", "--help");
  assert.equal(r.code, 0);
  assert.match(r.stdout, /--before <id>/);
  assert.match(r.stdout, /--after <id>/);
});
