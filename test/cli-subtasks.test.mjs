// `agentboard subtask ...` against a stub server: each command sends the
// request the API expects, and bad usage fails with a nonzero exit before
// anything is sent.
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
      if (req.method === "GET" && req.url === "/api/cards/7/subtasks") {
        res.end(JSON.stringify([
          { id: 1, card_id: 7, title: "Write tests", done: true, position: 0 },
          { id: 2, card_id: 7, title: "Ship it", done: false, position: 1 },
        ]));
      } else if (req.method === "POST") {
        res.statusCode = 201;
        res.end(JSON.stringify({ id: 3, card_id: 7, title: body.title, done: false, position: 2 }));
      } else if (req.method === "PATCH") {
        res.end(JSON.stringify({ id: 2, card_id: 7, title: body.title ?? "Ship it", done: body.done ?? false, position: 1 }));
      } else if (req.method === "DELETE") {
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

test("subtask list shows done state and progress", async () => {
  const r = await run("subtask", "list", "7");
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(requests.map((q) => `${q.method} ${q.url}`), ["GET /api/cards/7/subtasks"]);
  assert.match(r.stdout, /\[x\] +1 +Write tests/);
  assert.match(r.stdout, /\[ \] +2 +Ship it/);
  assert.match(r.stdout, /1\/2 done/);
});

test("subtask list --json passes the API response through", async () => {
  const r = await run("subtask", "list", "7", "--json");
  assert.equal(r.code, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).length, 2);
});

test("subtask add posts the title, joining extra words", async () => {
  const r = await run("subtask", "add", "7", "Update", "the", "README");
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(requests, [{ method: "POST", url: "/api/cards/7/subtasks", body: { title: "Update the README" } }]);
});

test("subtask done and undo set done", async () => {
  await run("subtask", "done", "2");
  assert.deepEqual(requests, [{ method: "PATCH", url: "/api/subtasks/2", body: { done: true } }]);
  await run("subtask", "undo", "2");
  assert.deepEqual(requests, [{ method: "PATCH", url: "/api/subtasks/2", body: { done: false } }]);
});

test("subtask rename and remove", async () => {
  await run("subtask", "rename", "2", "Ship", "v1");
  assert.deepEqual(requests, [{ method: "PATCH", url: "/api/subtasks/2", body: { title: "Ship v1" } }]);
  await run("subtask", "remove", "2");
  assert.deepEqual(requests, [{ method: "DELETE", url: "/api/subtasks/2", body: undefined }]);
});

test("bad usage exits nonzero and sends nothing", async () => {
  for (const args of [
    ["subtask", "add", "7"],
    ["subtask", "add"],
    ["subtask", "done"],
    ["subtask", "rename", "2"],
    ["subtask", "list"],
    ["subtask", "frobnicate", "2"],
    ["subtask", "done", "abc"],
  ]) {
    const r = await run(...args);
    assert.notEqual(r.code, 0, `${args.join(" ")} should fail`);
    assert.match(r.stderr, /Usage|Unknown|must be/, args.join(" "));
    assert.equal(requests.length, 0, `${args.join(" ")} should not call the API`);
  }
});
