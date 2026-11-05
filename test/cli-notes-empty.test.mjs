// `agentboard notes <id> --set ""` used to replace a card's whole description
// with nothing, without a word (AB-110: a generator script failed, its empty
// output went to --set, and the card had to be restored from a copy). Empty
// text is now refused before any request, `--clear` empties a description on
// purpose, and replacing one reports the old and new length.
//
//   node --test test/

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../cli/agentboard.js", import.meta.url));

// Card 5 has a description; card 6 has none.
const CARDS = {
  5: { id: 5, key: "AB-5", title: "Five", description: "Old notes" },
  6: { id: 6, key: "AB-6", title: "Six", description: null },
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
      const m = /^\/api\/cards\/(\d+)$/.exec(req.url);
      const card = m && CARDS[m[1]];
      if (card && req.method === "GET") {
        res.end(JSON.stringify(card));
      } else if (card && req.method === "PATCH") {
        res.end(JSON.stringify({ ...card, ...body }));
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

const patches = () => requests.filter((r) => r.method === "PATCH");

test("notes --set with empty text fails without touching the card", async () => {
  for (const args of [["--set", ""], ["--set="], ["--set", "  \n\t "]]) {
    const r = await run("notes", "5", ...args);
    assert.notEqual(r.code, 0, `${JSON.stringify(args)} should fail`);
    assert.deepEqual(requests, [], `${JSON.stringify(args)} must not reach the server`);
    assert.match(r.stderr, /--clear/, "the error says how to empty it on purpose");
    assert.equal(r.stdout, "");
  }
});

test("notes --clear empties the description on purpose", async () => {
  const r = await run("notes", "5", "--clear");
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(patches(), [{ method: "PATCH", url: "/api/cards/5", body: { description: "" } }]);
  assert.match(r.stderr, /Cleared the description of AB-5 \(was 9 characters\)/);
});

test("notes --clear on a card with no description still succeeds", async () => {
  const r = await run("notes", "6", "--clear", "--quiet");
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(patches(), [{ method: "PATCH", url: "/api/cards/6", body: { description: "" } }]);
  assert.equal(r.stdout.trim(), "AB-6");
  assert.match(r.stderr, /was 0 characters/);
});

test("notes --set reports the old and new length on stderr", async () => {
  const r = await run("notes", "5", "--set", "Brand new text", "--json");
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(patches(), [{ method: "PATCH", url: "/api/cards/5", body: { description: "Brand new text" } }]);
  assert.equal(JSON.parse(r.stdout).description, "Brand new text", "stdout stays plain JSON");
  assert.match(r.stderr, /Replaced the description of AB-5 \(was 9 characters, now 14\)/);
});

test("--clear can't be combined with --set or --append", async () => {
  for (const other of [["--set", "x"], ["--append", "x"]]) {
    const r = await run("notes", "5", "--clear", ...other);
    assert.notEqual(r.code, 0, `--clear ${other[0]} should fail`);
    assert.deepEqual(requests, []);
    assert.match(r.stderr, /--clear/);
  }
});

test("task update --description with empty text fails instead of being ignored", async () => {
  for (const args of [["--description", ""], ["--description", " ", "--title", "Renamed"]]) {
    const r = await run("task", "update", "5", ...args);
    assert.notEqual(r.code, 0, `${JSON.stringify(args)} should fail`);
    assert.deepEqual(requests, [], `${JSON.stringify(args)} must not reach the server`);
    assert.match(r.stderr, /notes 5 --clear/);
  }
});

test("notes --help lists --clear", async () => {
  const r = await run("notes", "--help");
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /--clear/);
});
