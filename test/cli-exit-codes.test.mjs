// Every failing CLI command must exit nonzero, so scripts and agents never
// read a failure as success. This walks the whole command table, not just the
// one command someone reported, against three ways a request can fail:
// the server answers with an error status, the server answers 200 with a body
// that isn't JSON (a proxy or login page), and nothing is listening at all.
//
//   node --test test/

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../cli/agentboard.js", import.meta.url));
const { COMMAND_FLAGS } = createRequire(import.meta.url)(CLI);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ab-exit-"));
const attachment = path.join(tmp, "note.txt");
fs.writeFileSync(attachment, "hello\n");

// Arguments that get each command past its own argument checks, so the
// failure under test is the request, not a usage error.
function argsFor(key) {
  const words = key.split(" ");
  const flags = [];
  const accepts = COMMAND_FLAGS[key];
  if (accepts.includes("product")) flags.push("--product", "p");
  if (accepts.includes("file")) flags.push("--file", attachment);
  if (accepts.includes("key")) flags.push("--key", "k", "--value", "v");
  if (accepts.includes("name")) flags.push("--name", "N");
  if (accepts.includes("ids")) flags.push("--ids", "1,2");
  if (accepts.includes("column") && !accepts.includes("product")) flags.push("--column", "todo");
  if (accepts.includes("org") && key === "product move") flags.push("--org", "o");
  if (accepts.includes("pr")) flags.push("--pr", "https://example.com/pr/1");
  // Most commands take an id; the rest take a name or title. Extra
  // positionals are harmless to the ones that don't want them.
  const positional = key === "status" ? ["1", "done"] : ["1", "x"];
  return [...words, ...positional, ...flags];
}

let mode = "500";
let server;
let baseUrl;
let deadUrl;

before(async () => {
  server = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      if (mode === "ok") {
        // A healthy server: any command that exits 0 here really succeeded,
        // so a usage error has to be caught before the request.
        res.setHeader("Content-Type", "application/json");
        res.end(req.method === "GET" ? "[]" : "{}");
      } else if (mode === "html") {
        res.setHeader("Content-Type", "text/html");
        res.end("<html><body>Sign in</body></html>");
      } else {
        res.statusCode = 500;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "boom" }));
      }
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  // A port that was just free: connection refused.
  const probe = http.createServer();
  await new Promise((r) => probe.listen(0, "127.0.0.1", r));
  deadUrl = `http://127.0.0.1:${probe.address().port}`;
  await new Promise((r) => probe.close(r));
});

after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  return new Promise((r) => server.close(r));
});

function run(url, args, env = {}) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [CLI, ...args],
      {
        env: {
          PATH: process.env.PATH,
          AGENTBOARD_URL: url,
          AGENTBOARD_TOKEN: "t",
          AGENTBOARD_AGENT_NAME: "Tester",
          ...env,
        },
        timeout: 15000,
      },
      (err, stdout, stderr) => {
        resolve({ code: err ? err.code : 0, stdout, stderr });
      }
    );
  });
}

const commands = Object.keys(COMMAND_FLAGS);

test("the command table is exported and covers the CLI", () => {
  assert.ok(commands.length > 40, `only ${commands.length} commands found`);
});

for (const [label, setup] of [
  ["server error (HTTP 500)", () => ((mode = "500"), baseUrl)],
  ["200 with a non-JSON body", () => ((mode = "html"), baseUrl)],
  ["connection refused", () => deadUrl],
]) {
  test(`every command exits nonzero on ${label}`, async () => {
    const url = setup();
    const results = await Promise.all(
      commands.map(async (key) => ({ args: argsFor(key), r: await run(url, argsFor(key)) }))
    );
    const zero = results
      .filter(({ r }) => r.code === 0 || !r.stderr.trim())
      .map(({ args, r }) => `agentboard ${args.join(" ")} -> exit ${r.code}, stderr ${JSON.stringify(r.stderr.trim())}`);
    assert.deepEqual(zero, [], `commands that hid a failure:\n${zero.join("\n")}`);
  });
}

test("a non-JSON 200 says what came back instead of a bare parse error", async () => {
  mode = "html";
  const r = await run(baseUrl, ["show", "1"]);
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /not JSON|non-JSON|expected JSON/i);
  assert.match(r.stderr, /Sign in|<html/);
});

test("a refused connection names the server it tried", async () => {
  const r = await run(deadUrl, ["show", "1"]);
  assert.notEqual(r.code, 0);
  assert.ok(r.stderr.includes(deadUrl), r.stderr);
});

test("usage errors exit nonzero", async () => {
  const cases = [
    ["bogus"],
    ["task", "bogus"],
    ["org", "bogus"],
    ["product", "bogus"],
    ["board", "bogus"],
    ["column", "bogus"],
    ["member", "bogus"],
    ["subtask", "bogus"],
    ["attachment", "bogus"],
    ["show", "1", "--nope"],
    ["show", "1", "--title"],
    ["task", "attach", "1", "--file", path.join(tmp, "missing.txt")],
    // Half a settings write must not quietly turn into a read.
    ["settings", "--key", "k"],
    ["settings", "--value", "v"],
    ["preferences", "--key", "k"],
    ["preferences", "--value", "v"],
  ];
  mode = "ok";
  const zero = [];
  for (const args of cases) {
    const r = await run(baseUrl, args);
    if (r.code === 0) zero.push(`agentboard ${args.join(" ")}`);
  }
  assert.deepEqual(zero, [], `exited 0:\n${zero.join("\n")}`);
});

test("missing AGENTBOARD_URL exits nonzero", async () => {
  const r = await run("", ["show", "1"]);
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /AGENTBOARD_URL/);
});
