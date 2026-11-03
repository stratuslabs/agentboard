// `agentboard enroll <token>` against a stub server (card 17). A setup prompt
// carries a short-lived, single-use enrollment token instead of the agent's
// long-lived key. The CLI trades it for the key and saves the key, agent name,
// product and board to a config file only the user can read, and later
// commands use that file, for that server only, when the environment doesn't
// say otherwise.
//
//   node --test test/

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../cli/agentboard.js", import.meta.url));

const KEY = "ab_live_0123456789abcdef";
const ENROLLED = { key: KEY, agent_name: "Rook", product: "agentboard", board: "development" };

/** @type {{ method: string, url: string, auth: string | undefined, body: string }[]} */
let requests = [];
let used = new Set();
let server;
let baseUrl;
let tmp;
let configPath;

before(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      requests.push({ method: req.method, url: req.url, auth: req.headers.authorization, body });
      const json = (status, value) => {
        res.statusCode = status;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(value));
      };
      if (req.method === "POST" && req.url === "/api/agents/enroll") {
        const token = (req.headers.authorization || "").replace(/^Bearer /, "");
        if ((token === "abe_good" || token === "abe_other") && !used.has(token)) {
          used.add(token);
          return json(200, ENROLLED);
        }
        return json(401, { error: "Enrollment token is invalid, expired or already used" });
      }
      if (req.method === "POST" && req.url === "/selfhosted/api/agents/enroll") {
        return json(404, { error: "Not found" });
      }
      if (req.method === "GET" && req.url.startsWith("/api/products")) return json(200, []);
      return json(404, { error: "Not found" });
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((r) => server.close(r));
});

beforeEach(() => {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ab-enroll-"));
  configPath = path.join(tmp, "agentboard", "config.json");
  used = new Set();
});

// No AGENTBOARD_* from the machine running the tests; the config file lives
// in a fresh temp dir per test.
function run(args, env = {}) {
  requests = [];
  const clean = { ...process.env };
  for (const k of Object.keys(clean)) if (k.startsWith("AGENTBOARD_")) delete clean[k];
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [CLI, ...args],
      { env: { ...clean, AGENTBOARD_CONFIG: configPath, ...env } },
      (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr }),
    );
  });
}

test("enroll trades the token for a key and saves it, readable only by the user", async () => {
  const r = await run(["enroll", "abe_good", "--url", baseUrl]);
  assert.equal(r.code, 0, r.stderr);
  const enroll = requests.find((q) => q.url === "/api/agents/enroll");
  assert.ok(enroll, "no enroll request");
  assert.equal(enroll.method, "POST");
  assert.equal(enroll.auth, "Bearer abe_good");

  const saved = JSON.parse(fs.readFileSync(configPath, "utf8"));
  assert.deepEqual(saved, { url: baseUrl, token: KEY, agent_name: "Rook", product: "agentboard", board: "development" });
  if (process.platform !== "win32") {
    assert.equal(fs.statSync(configPath).mode & 0o777, 0o600);
  }
  // The key is never printed: the output lands in the same transcript the
  // prompt did.
  assert.ok(!r.stdout.includes(KEY) && !r.stderr.includes(KEY), r.stdout + r.stderr);
  assert.match(r.stdout, /Rook/);
  assert.ok(r.stdout.includes(configPath), r.stdout);
});

test("enroll --json reports what was saved, without the key", async () => {
  const r = await run(["enroll", "abe_good", "--url", baseUrl, "--json"]);
  assert.equal(r.code, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.deepEqual(out, { url: baseUrl, agent_name: "Rook", product: "agentboard", board: "development", config: configPath });
});

test("enroll reads the server from AGENTBOARD_URL when --url is absent", async () => {
  const r = await run(["enroll", "abe_good"], { AGENTBOARD_URL: baseUrl });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(JSON.parse(fs.readFileSync(configPath, "utf8")).url, baseUrl);
});

test("enroll --name asks for that agent name", async () => {
  const r = await run(["enroll", "abe_good", "--url", baseUrl, "--name", "Rook"]);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(JSON.parse(requests[0].body), { name: "Rook" });
});

test("a reused token is refused, says why, and leaves the saved config alone", async () => {
  assert.equal((await run(["enroll", "abe_good", "--url", baseUrl])).code, 0);
  const before = fs.readFileSync(configPath, "utf8");
  const r = await run(["enroll", "abe_good", "--url", baseUrl, "--force"]);
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /HTTP 401/);
  assert.match(r.stderr, /new setup prompt/);
  assert.equal(fs.readFileSync(configPath, "utf8"), before);
});

test("an unknown or expired token is refused and nothing is written", async () => {
  const r = await run(["enroll", "abe_expired", "--url", baseUrl]);
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /HTTP 401/);
  assert.ok(!fs.existsSync(configPath));
});

test("an existing config is not replaced without --force, and the token is not spent", async () => {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify({ url: "https://other.example", token: "ab_old" }));
  const r = await run(["enroll", "abe_good", "--url", baseUrl]);
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /--force/);
  assert.equal(requests.length, 0, "the single-use token was sent before checking the config");
  assert.equal(JSON.parse(fs.readFileSync(configPath, "utf8")).token, "ab_old");

  const forced = await run(["enroll", "abe_good", "--url", baseUrl, "--force"]);
  assert.equal(forced.code, 0, forced.stderr);
  assert.equal(JSON.parse(fs.readFileSync(configPath, "utf8")).token, KEY);
});

test("a server without enrollment (self-hosted) gets a pointer to AGENTBOARD_TOKEN", async () => {
  const r = await run(["enroll", "abe_good", "--url", `${baseUrl}/selfhosted`]);
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /HTTP 404/);
  assert.match(r.stderr, /AGENTBOARD_TOKEN/);
  assert.ok(!fs.existsSync(configPath));
});

test("enroll without a token or a server explains the usage", async () => {
  const noToken = await run(["enroll", "--url", baseUrl]);
  assert.notEqual(noToken.code, 0);
  assert.match(noToken.stderr, /Usage: agentboard enroll/);
  const noUrl = await run(["enroll", "abe_good"]);
  assert.notEqual(noUrl.code, 0);
  assert.match(noUrl.stderr, /--url/);
  assert.equal(requests.length, 0);
});

test("after enrolling, commands use the saved server, key, agent and product", async () => {
  assert.equal((await run(["enroll", "abe_good", "--url", baseUrl])).code, 0);
  const r = await run(["list"]);
  assert.ok(!/Set AGENTBOARD_URL|Set AGENTBOARD_PRODUCT/.test(r.stderr), r.stderr);
  const get = requests.find((q) => q.method === "GET");
  assert.ok(get, `no request made: ${r.stderr}`);
  assert.equal(get.auth, `Bearer ${KEY}`);
});

test("the environment wins over the saved config", async () => {
  assert.equal((await run(["enroll", "abe_good", "--url", baseUrl])).code, 0);
  await run(["product", "list"], { AGENTBOARD_TOKEN: "ab_from_env" });
  assert.equal(requests[0].auth, "Bearer ab_from_env");
});

test("the saved key is never sent to a different AGENTBOARD_URL", async () => {
  assert.equal((await run(["enroll", "abe_good", "--url", baseUrl])).code, 0);
  // The same stub under another base URL stands in for another server.
  const r = await run(["product", "list"], { AGENTBOARD_URL: `${baseUrl}/elsewhere` });
  assert.equal(requests[0].auth, undefined, r.stderr);
  assert.ok(requests[0].url.startsWith("/elsewhere/"), requests[0].url);
});

test("the saved config still applies when AGENTBOARD_URL names the same server", async () => {
  assert.equal((await run(["enroll", "abe_good", "--url", baseUrl])).code, 0);
  await run(["product", "list"], { AGENTBOARD_URL: `${baseUrl}/` });
  assert.equal(requests[0].auth, `Bearer ${KEY}`);
});

test("an unreadable config is an error that names the file", async () => {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, "{ not json");
  const r = await run(["product", "list"]);
  assert.notEqual(r.code, 0);
  assert.ok(r.stderr.includes(configPath), r.stderr);
});

test("with neither environment nor config, the AGENTBOARD_URL error mentions enroll", async () => {
  const r = await run(["product", "list"]);
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /AGENTBOARD_URL/);
  assert.match(r.stderr, /agentboard enroll/);
});
