// Text flags carry whatever text they're given, including lines that start
// with `--`. Agents put CLI flags in descriptions all the time, and an older
// parser saved such a description as the word "true" (card 22).
//
// The one case the CLI can't read safely is a text flag followed by a bare
// flag name, like `--description --priority high`: that is almost always a
// missing value, and taking `--priority` as the description would silently
// drop the priority. The CLI refuses it and says how to pass it on purpose.
//
//   node --test test/

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../cli/agentboard.js", import.meta.url));

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
      if (req.method === "GET" && req.url === "/api/products") {
        res.end(JSON.stringify([{ id: 1, slug: "p", name: "P" }]));
      } else if (req.method === "GET" && req.url === "/api/boards?product_id=1") {
        res.end(JSON.stringify([{ id: 6, slug: "b", name: "B" }]));
      } else if (req.method === "GET" && req.url === "/api/columns?board_id=6") {
        res.end(JSON.stringify([{ id: 21, board_id: 6, name: "Todo", slug: "todo", position: 0 }]));
      } else if (req.method === "POST" && req.url === "/api/cards") {
        res.end(JSON.stringify({ id: 99, ...body }));
      } else if (req.method === "GET" && req.url === "/api/cards/5") {
        res.end(JSON.stringify({ id: 5, title: "C", description: "Old" }));
      } else if (req.method === "PATCH" && req.url === "/api/cards/5") {
        res.end(JSON.stringify({ id: 5, ...body }));
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

const created = () => requests.find((q) => q.method === "POST" && q.url === "/api/cards");
const NEW = ["new", "T", "--product", "p", "--board", "b", "--json"];

test("a description with -- lines is sent intact", async () => {
  const d = "Fix the parser.\n--column todo is how you move it\n  --priority high\n--";
  const r = await run(...NEW, "--description", d);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(created().body.description, d);
});

test("a description that starts with -- text is sent intact", async () => {
  for (const d of ["--dry-run is broken", "--priority high", "--", "---"]) {
    const r = await run(...NEW, "--description", d);
    assert.equal(r.code, 0, `${d}: ${r.stderr}`);
    assert.equal(created().body.description, d);
  }
});

test("a text flag followed by a bare flag name is refused and sends nothing", async () => {
  for (const [flag, next] of [
    ["--description", "--priority"],
    ["--description", "--json"],
    ["--label", "--description"],
    ["--assignee", "--due"],
  ]) {
    const r = await run(...NEW, flag, next, "high");
    assert.notEqual(r.code, 0, `${flag} ${next} should fail`);
    assert.equal(created(), undefined, `${flag} ${next} must not create a card`);
    assert.match(r.stderr, new RegExp(`${flag} needs a value`));
    assert.match(r.stderr, new RegExp(`${flag}=${next}`));
  }
});

test("the = form passes a bare flag name as text on purpose", async () => {
  const r = await run(...NEW, "--description=--priority");
  assert.equal(r.code, 0, r.stderr);
  assert.equal(created().body.description, "--priority");
});

test("notes --append and --set keep -- lines too", async () => {
  let r = await run("notes", "5", "--append", "--flag one\n--flag two");
  assert.equal(r.code, 0, r.stderr);
  assert.match(requests.at(-1).body.description, /Old\n+--flag one\n--flag two$/);

  r = await run("notes", "5", "--set", "--priority");
  assert.notEqual(r.code, 0);
  assert.equal(requests.filter((q) => q.method === "PATCH").length, 0);
});
