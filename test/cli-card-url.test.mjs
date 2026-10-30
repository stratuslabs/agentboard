// `agentboard show` and `task show` against a stub server: the card's link
// (`url`) is passed through in --json and printed near the top of the plain
// output, so an agent can cite the card itself. A server too old to send
// `url` gets one built from AGENTBOARD_URL, which reaches the same /c/<id>.
//
//   node --test test/

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../cli/agentboard.js", import.meta.url));
const LINK = "https://board.example.com/c/7";

let server;
let baseUrl;

before(async () => {
  server = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.method === "GET" && req.url === "/api/cards/7") {
      res.end(JSON.stringify({
        id: 7, title: "Ship it", key: "WG-7", description: "line one\nline two", url: LINK,
      }));
    } else if (req.method === "GET" && req.url === "/api/cards/8") {
      // A server from before cards carried their link.
      res.end(JSON.stringify({ id: 8, title: "Older server", key: null }));
    } else {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: "Not found" }));
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((r) => server.close(r)));

function run(args, url = baseUrl) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [CLI, ...args],
      { env: { ...process.env, AGENTBOARD_URL: url, AGENTBOARD_TOKEN: "", AGENTBOARD_AGENT_NAME: "" } },
      (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr }),
    );
  });
}

for (const cmd of [["show"], ["task", "show"]]) {
  const name = cmd.join(" ");

  test(`${name} --json passes the server's url through`, async () => {
    const r = await run([...cmd, "7", "--json"]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).url, LINK);
  });

  test(`${name} prints the url right after the card's id and key`, async () => {
    const r = await run([...cmd, "7"]);
    assert.equal(r.code, 0, r.stderr);
    const keys = r.stdout.split("\n").filter(Boolean).map((line) => line.split(/\s+/)[0]);
    assert.deepEqual(keys.slice(0, 3), ["id", "key", "url"]);
    assert.match(r.stdout, new RegExp(`^url\\s+${LINK}$`, "m"));
  });

  test(`${name} builds the url from AGENTBOARD_URL when the server sends none`, async () => {
    const r = await run([...cmd, "8", "--json"]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).url, `${baseUrl}/c/8`);

    const slash = await run([...cmd, "8", "--json"], `${baseUrl}/`);
    assert.equal(JSON.parse(slash.stdout).url, `${baseUrl}/c/8`);
  });
}

test("show --quiet still prints only the id", async () => {
  const r = await run(["show", "7", "--quiet"]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, "7\n");
});
