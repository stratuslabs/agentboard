// Settings > Default boards / Default columns: a save only reads "Saved" when
// the server actually stored it. A 4xx/5xx or a dropped connection comes back
// as an error with a message the UI can show, and the edit stays on screen.
//
//   node --test test/

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { saveSetting } from "../src/lib/settings-save.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

function fakeFetch(respond) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    return respond(url, init);
  };
  return { impl, calls };
}

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("a 200 is a successful save, sent as PATCH /api/settings {key, value}", async () => {
  const { impl, calls } = fakeFetch(() => json(200, { key: "default_boards" }));
  const result = await saveSetting("default_boards", ["Development", "Support"], impl);
  assert.deepEqual(result, { ok: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/settings");
  assert.equal(calls[0].init.method, "PATCH");
  assert.equal(calls[0].init.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(calls[0].init.body), { key: "default_boards", value: ["Development", "Support"] });
});

test("a 500 with a JSON error is a failure carrying the server's message", async () => {
  const { impl } = fakeFetch(() => json(500, { error: "database is read-only" }));
  const result = await saveSetting("default_columns", [], impl);
  assert.equal(result.ok, false);
  assert.match(result.message, /database is read-only/);
});

test("a 404 with a non-JSON body is a failure naming the status", async () => {
  const { impl } = fakeFetch(() => new Response("<html>Not Found</html>", { status: 404 }));
  const result = await saveSetting("default_boards", [], impl);
  assert.equal(result.ok, false);
  assert.match(result.message, /404/);
});

test("a 401 with an empty error field still names the status", async () => {
  const { impl } = fakeFetch(() => json(401, { error: "" }));
  const result = await saveSetting("default_boards", [], impl);
  assert.equal(result.ok, false);
  assert.match(result.message, /401/);
});

test("a dropped connection is a failure, not a thrown error", async () => {
  const impl = async () => { throw new TypeError("Failed to fetch"); };
  const result = await saveSetting("default_boards", [], impl);
  assert.equal(result.ok, false);
  assert.match(result.message, /couldn.t reach/i);
});

test("DefaultLists saves through saveSetting and renders its error", () => {
  const src = readFileSync(`${ROOT}src/components/settings/DefaultLists.tsx`, "utf8");
  assert.match(src, /saveSetting\(/, "useSaver should call saveSetting");
  assert.doesNotMatch(src, /method:\s*"PATCH"/, "no unchecked fetch PATCH left in the component");
  assert.match(src, /role="alert"/, "a failed save is announced");
});
