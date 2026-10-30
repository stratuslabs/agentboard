// Settings > Members: renaming or recolouring a member only closes the editor
// when the server stored it. A 409 (another agent already has that name), any
// other 4xx/5xx, or a dropped connection comes back as a message the editor
// shows, with the edit kept open.
//
//   node --test test/

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { saveMember } from "../src/lib/member-save.js";

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

test("a 200 is a successful save, sent as PATCH /api/members/:id {name, color}", async () => {
  const saved = { id: 7, name: "Nova", color: "#6B7280", type: "agent" };
  const { impl, calls } = fakeFetch(() => json(200, saved));
  const result = await saveMember(7, { name: "Nova", color: "#6B7280" }, impl);
  assert.deepEqual(result, { ok: true, member: saved });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/members/7");
  assert.equal(calls[0].init.method, "PATCH");
  assert.equal(calls[0].init.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(calls[0].init.body), { name: "Nova", color: "#6B7280" });
});

test("only the fields given are sent, so a color save can't resend a stale name", async () => {
  const { impl, calls } = fakeFetch(() => json(200, { id: 7 }));
  await saveMember(7, { color: "#EF4444" }, impl);
  assert.deepEqual(JSON.parse(calls[0].init.body), { color: "#EF4444" });
});

test("a 409 duplicate agent name is a failure carrying the server's reason", async () => {
  const { impl } = fakeFetch(() => json(409, { error: "Another agent on this team already uses that name." }));
  const result = await saveMember(7, { name: "Blair", color: "#6B7280" }, impl);
  assert.equal(result.ok, false);
  assert.match(result.message, /Another agent on this team already uses that name\./);
});

test("a 500 with a non-JSON body is a failure naming the status", async () => {
  const { impl } = fakeFetch(() => new Response("<html>Internal Server Error</html>", { status: 500 }));
  const result = await saveMember(7, { name: "Nova", color: "#6B7280" }, impl);
  assert.equal(result.ok, false);
  assert.match(result.message, /500/);
});

test("a 404 with an empty error field still names the status", async () => {
  const { impl } = fakeFetch(() => json(404, { error: "  " }));
  const result = await saveMember(7, { name: "Nova", color: "#6B7280" }, impl);
  assert.equal(result.ok, false);
  assert.match(result.message, /404/);
});

test("a dropped connection is a failure, not a thrown error", async () => {
  const impl = async () => { throw new TypeError("Failed to fetch"); };
  const result = await saveMember(7, { name: "Nova", color: "#6B7280" }, impl);
  assert.equal(result.ok, false);
  assert.match(result.message, /couldn.t reach/i);
});

test("the member editor saves through saveMember and shows its error", () => {
  const members = readFileSync(`${ROOT}src/components/settings/BoardMembers.tsx`, "utf8");
  assert.match(members, /saveMember\(/, "the rename path should call saveMember");
  assert.doesNotMatch(members, /method:\s*"PATCH"/, "no unchecked fetch PATCH left in BoardMembers");
  const editor = readFileSync(`${ROOT}src/components/settings/MemberList.tsx`, "utf8");
  assert.match(editor, /role="alert"/, "a failed save is announced in the editor");
});
