// `agentboard attachment get <id>` against a stub server: an agent can read a
// card's attachment, to stdout or to a file. Writing a file never overwrites
// one that exists unless --force is given, and the server's filename can't
// steer the write outside the directory named by --out.
//
//   node --test test/

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../cli/agentboard.js", import.meta.url));

const NOTES = "# Notes\n\nSecond paragraph, no trailing newline added";
const ATTACHMENTS = {
  5: { id: 5, card_id: 7, filename: "notes.md", content: NOTES, created_at: "2026-10-29T12:00:00.000Z" },
  6: { id: 6, card_id: 7, filename: "../../escape.md", content: "nope", created_at: "2026-10-29T12:00:00.000Z" },
  8: { id: 8, card_id: 7, filename: "..", content: "dots", created_at: "2026-10-29T12:00:00.000Z" },
};

/** @type {{ method: string, url: string }[]} */
let requests = [];
let server;
let baseUrl;
let tmp;

before(async () => {
  server = http.createServer((req, res) => {
    requests.push({ method: req.method, url: req.url });
    const m = /^\/api\/attachments\/(\d+)$/.exec(req.url);
    if (req.method === "GET" && m && ATTACHMENTS[m[1]]) {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(ATTACHMENTS[m[1]]));
    } else if (req.method === "GET" && req.url === "/api/attachments/9") {
      // An older server: the route exists for DELETE only, so Next answers 405.
      res.statusCode = 405;
      res.end();
    } else {
      res.statusCode = 404;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Not found" }));
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ab-attachment-get-"));
});

after(async () => {
  fs.rmSync(tmp, { recursive: true, force: true });
  await new Promise((r) => server.close(r));
});

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

function freshDir(name) {
  const dir = path.join(tmp, name);
  fs.mkdirSync(dir);
  return dir;
}

test("attachment get prints the content exactly, nothing added", async () => {
  const r = await run("attachment", "get", "5");
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, NOTES);
  assert.deepEqual(requests, [{ method: "GET", url: "/api/attachments/5" }]);
});

test("attachment get --json prints the attachment record", async () => {
  const r = await run("attachment", "get", "5", "--json");
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), ATTACHMENTS[5]);
});

test("--out <file> writes the content there and says where", async () => {
  const dir = freshDir("to-file");
  const target = path.join(dir, "copy.md");
  const r = await run("attachment", "get", "5", "--out", target);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(fs.readFileSync(target, "utf-8"), NOTES);
  assert.equal(r.stdout, `Saved notes.md to ${target} (${Buffer.byteLength(NOTES)} bytes)\n`);
});

test("--out <dir> writes <dir>/<filename>", async () => {
  const dir = freshDir("to-dir");
  const r = await run("attachment", "get", "5", "--out", dir);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(fs.readFileSync(path.join(dir, "notes.md"), "utf-8"), NOTES);
});

test("--out with a trailing slash names a directory that must exist", async () => {
  const missing = path.join(tmp, "no-such-dir") + path.sep;
  const r = await run("attachment", "get", "5", "--out", missing);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /Directory not found/);
  assert.equal(fs.existsSync(missing), false);
});

test("--out into a missing directory fails clearly", async () => {
  const target = path.join(tmp, "missing-parent", "copy.md");
  const r = await run("attachment", "get", "5", "--out", target);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /Directory not found/);
});

test("an existing file is never overwritten without --force", async () => {
  const dir = freshDir("exists");
  const target = path.join(dir, "notes.md");
  fs.writeFileSync(target, "mine");
  const r = await run("attachment", "get", "5", "--out", target);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /already exists.*--force/);
  assert.equal(fs.readFileSync(target, "utf-8"), "mine");

  const viaDir = await run("attachment", "get", "5", "--out", dir);
  assert.equal(viaDir.code, 1);
  assert.equal(fs.readFileSync(target, "utf-8"), "mine");

  const forced = await run("attachment", "get", "5", "--out", target, "--force");
  assert.equal(forced.code, 0, forced.stderr);
  assert.equal(fs.readFileSync(target, "utf-8"), NOTES);
});

test("the server's filename can't write outside the --out directory", async () => {
  const dir = freshDir("escape");
  const r = await run("attachment", "get", "6", "--out", dir);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(fs.readFileSync(path.join(dir, "escape.md"), "utf-8"), "nope");
  assert.equal(fs.existsSync(path.join(tmp, "..", "escape.md")), false);
  assert.equal(fs.existsSync(path.join(tmp, "escape.md")), false);

  const dots = await run("attachment", "get", "8", "--out", dir);
  assert.equal(dots.code, 0, dots.stderr);
  assert.equal(fs.readFileSync(path.join(dir, "attachment-8"), "utf-8"), "dots");
});

test("--quiet --out prints only the path; --json --out prints the record without content", async () => {
  const dir = freshDir("quiet-json");
  const quiet = await run("attachment", "get", "5", "--out", path.join(dir, "q.md"), "--quiet");
  assert.equal(quiet.code, 0, quiet.stderr);
  assert.equal(quiet.stdout, `${path.join(dir, "q.md")}\n`);

  const json = await run("attachment", "get", "5", "--out", path.join(dir, "j.md"), "--json");
  assert.equal(json.code, 0, json.stderr);
  const { content, ...meta } = ATTACHMENTS[5];
  assert.equal(content, NOTES);
  assert.deepEqual(JSON.parse(json.stdout), {
    ...meta,
    path: path.join(dir, "j.md"),
    bytes: Buffer.byteLength(NOTES),
  });
});

test("usage errors exit nonzero before any request", async () => {
  for (const args of [["attachment", "get"], ["attachment", "get", "abc"], ["attachment", "get", "0"]]) {
    const r = await run(...args);
    assert.equal(r.code, 1, args.join(" "));
    assert.match(r.stderr, /Usage: agentboard attachment get <attachment-id>/);
    assert.deepEqual(requests, []);
  }
  const flag = await run("attachment", "get", "5", "--file", "x");
  assert.equal(flag.code, 1);
  assert.match(flag.stderr, /'attachment get' does not accept --file/);
});

test("a missing attachment fails with the server's error", async () => {
  const r = await run("attachment", "get", "404");
  assert.equal(r.code, 1);
  assert.match(r.stderr, /HTTP 404: Not found/);
  assert.equal(r.stdout, "");
});

test("an older server without the download route gets a hint", async () => {
  const r = await run("attachment", "get", "9");
  assert.equal(r.code, 1);
  assert.match(r.stderr, /HTTP 405/);
  assert.match(r.stderr, /task attachments <card-id> --json/);
});

test("unknown attachment subcommands list get and remove", async () => {
  const r = await run("attachment", "fetch", "5");
  assert.equal(r.code, 1);
  assert.match(r.stderr, /Use: get, remove/);
});
