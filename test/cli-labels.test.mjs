// `agentboard task update --add-label / --remove-label` against a stub server:
// adding or removing one label keeps the card's other labels, instead of
// replacing the whole string the way --label does.
//
//   node --test test/

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../cli/agentboard.js", import.meta.url));

// Card 7 has labels typed in the web UI (spaces after commas); card 8 has none.
const CARDS = {
  7: { id: 7, title: "Seven", labels: "cli, feedback" },
  8: { id: 8, title: "Eight", labels: "" },
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

test("--add-label keeps the existing labels and adds the new one", async () => {
  const r = await run("task", "update", "7", "--add-label", "bug", "--json");
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(requests, [
    { method: "GET", url: "/api/cards/7", body: undefined },
    { method: "PATCH", url: "/api/cards/7", body: { labels: "cli,feedback,bug" } },
  ]);
  assert.equal(JSON.parse(r.stdout).labels, "cli,feedback,bug");
});

test("--remove-label removes only that label", async () => {
  const r = await run("task", "update", "7", "--remove-label", "cli");
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(patches(), [{ method: "PATCH", url: "/api/cards/7", body: { labels: "feedback" } }]);
});

test("--remove-label matches case-insensitively, like the board's label filter", async () => {
  const r = await run("task", "update", "7", "--remove-label", "FEEDBACK");
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(patches(), [{ method: "PATCH", url: "/api/cards/7", body: { labels: "cli" } }]);
});

test("removing the last label leaves the card with none", async () => {
  const r = await run("task", "update", "7", "--remove-label", "cli,feedback");
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(patches(), [{ method: "PATCH", url: "/api/cards/7", body: { labels: "" } }]);
});

test("--add-label works on a card with no labels", async () => {
  const r = await run("task", "update", "8", "--add-label", "bug");
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(patches(), [{ method: "PATCH", url: "/api/cards/8", body: { labels: "bug" } }]);
});

test("both flags take a comma-separated list and can be repeated", async () => {
  const r = await run(
    "task", "update", "7",
    "--add-label", "a, b", "--add-label", "c",
    "--remove-label", "cli", "--remove-label", "nope",
  );
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(patches(), [{ method: "PATCH", url: "/api/cards/7", body: { labels: "feedback,a,b,c" } }]);
});

test("adding a label the card already has changes nothing", async () => {
  const r = await run("task", "update", "7", "--add-label", "CLI", "--json");
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(patches(), []);
  assert.match(r.stderr, /already has label 'CLI'/);
  assert.equal(JSON.parse(r.stdout).labels, "cli, feedback");
});

test("removing a label the card doesn't have changes nothing and says so", async () => {
  const r = await run("task", "update", "7", "--remove-label", "bug");
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(patches(), []);
  assert.match(r.stderr, /doesn't have label 'bug'/);
});

test("label changes go in the same PATCH as other field updates", async () => {
  const r = await run("task", "update", "7", "--add-label", "bug", "--priority", "high");
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(patches(), [
    { method: "PATCH", url: "/api/cards/7", body: { priority: "high", labels: "cli,feedback,bug" } },
  ]);
});

test("--label still replaces all labels, and --label '' still clears them", async () => {
  let r = await run("task", "update", "7", "--label", "only");
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(requests, [{ method: "PATCH", url: "/api/cards/7", body: { labels: "only" } }]);
  r = await run("task", "update", "7", "--label", "");
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(requests, [{ method: "PATCH", url: "/api/cards/7", body: { labels: "" } }]);
});

test("--label with --add-label or --remove-label is an error and sends nothing", async () => {
  for (const flag of ["--add-label", "--remove-label"]) {
    const r = await run("task", "update", "7", "--label", "x", flag, "y");
    assert.notEqual(r.code, 0, `${flag} with --label should fail`);
    assert.match(r.stderr, /--label replaces all labels/);
    assert.deepEqual(requests, []);
  }
});

test("an empty --add-label or --remove-label is an error and sends nothing", async () => {
  for (const args of [["--add-label", ""], ["--remove-label", " , "]]) {
    const r = await run("task", "update", "7", ...args);
    assert.notEqual(r.code, 0, `${args.join(" ")} should fail`);
    assert.match(r.stderr, /needs at least one label/);
    assert.deepEqual(requests, []);
  }
});

test("the same label in --add-label and --remove-label is an error", async () => {
  const r = await run("task", "update", "7", "--add-label", "bug", "--remove-label", "Bug");
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /both --add-label and --remove-label/);
  assert.deepEqual(requests, []);
});

test("a missing card fails before anything is written", async () => {
  const r = await run("task", "update", "99", "--add-label", "bug");
  assert.notEqual(r.code, 0);
  assert.deepEqual(patches(), []);
});
