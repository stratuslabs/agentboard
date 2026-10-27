// `agentboard task link|links|unlink` against a stub server: a card can link
// any URL (a Slack thread, a doc, a design), not only a GitHub issue or PR.
// Each command sends the request the API expects, and bad usage fails with a
// nonzero exit before anything is sent.
//
//   node --test test/

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../cli/agentboard.js", import.meta.url));
const SLACK = "https://stratuslabs.slack.com/archives/C0123456789/p1791332967606559";
const DOC = "https://docs.google.com/document/d/abc/edit";

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
      if (req.method === "GET" && req.url === "/api/cards/7/links") {
        res.end(JSON.stringify([
          { id: 1, card_id: 7, url: SLACK, title: "Launch thread" },
          { id: 2, card_id: 7, url: DOC, title: null },
        ]));
      } else if (req.method === "POST" && req.url === "/api/cards/7/links") {
        res.statusCode = 201;
        res.end(JSON.stringify({ id: 3, card_id: 7, url: body.url, title: body.title ?? null }));
      } else if (req.method === "PATCH") {
        res.end(JSON.stringify({ id: 7, ...body }));
      } else if (req.method === "DELETE" && req.url === "/api/cards/7/links") {
        res.end(JSON.stringify({ success: true }));
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

test("task link --url posts any URL as a card link", async () => {
  const r = await run("task", "link", "7", "--url", SLACK);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(requests, [{ method: "POST", url: "/api/cards/7/links", body: { url: SLACK } }]);
});

test("task link --url takes an optional --title", async () => {
  const r = await run("task", "link", "7", "--url", DOC, "--title", "Design doc");
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(requests, [{ method: "POST", url: "/api/cards/7/links", body: { url: DOC, title: "Design doc" } }]);
});

test("task link --pr and --issue still set the GitHub fields", async () => {
  const pr = "https://github.com/stratuslabs/agentboard/pull/67";
  const r = await run("task", "link", "7", "--pr", pr);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(requests, [{ method: "PATCH", url: "/api/cards/7", body: { github_pr_url: pr } }]);
});

test("task links lists a card's links", async () => {
  const r = await run("task", "links", "7");
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(requests.map((q) => `${q.method} ${q.url}`), ["GET /api/cards/7/links"]);
  assert.match(r.stdout, /Launch thread/);
  assert.ok(r.stdout.includes(SLACK));
  assert.ok(r.stdout.includes(DOC));
});

test("task links --json passes the API response through", async () => {
  const r = await run("task", "links", "7", "--json");
  assert.equal(r.code, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).length, 2);
});

test("task unlink --url removes that link", async () => {
  const r = await run("task", "unlink", "7", "--url", DOC);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(requests, [{ method: "DELETE", url: "/api/cards/7/links", body: { url: DOC } }]);
});

test("bad usage exits nonzero and sends nothing", async () => {
  for (const args of [
    ["task", "link", "7"],
    ["task", "link", "--url", SLACK],
    ["task", "link", "7", "--title", "x"],
    ["task", "links"],
    ["task", "unlink", "7"],
    ["task", "unlink", "--url", DOC],
  ]) {
    const r = await run(...args);
    assert.notEqual(r.code, 0, `${args.join(" ")} should fail`);
    assert.match(r.stderr, /Usage|Provide|requires/, args.join(" "));
    assert.equal(requests.length, 0, `${args.join(" ")} should not call the API`);
  }
});
