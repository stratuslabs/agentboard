// The team's product keys, for linking card references in a description that
// read like standards (TLS-13) but name a real product (AB-148). A load that
// fails returns no keys, so those references stay text, as they did before.
//
//   node --test test/

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadTeamProductKeys } from "../src/lib/team-product-keys.js";

const answer = (status, body) => async (url) => {
  answer.url = url;
  return { ok: status >= 200 && status < 300, status, json: async () => body };
};

test("returns every product's key from GET /api/products", async () => {
  const keys = await loadTeamProductKeys(answer(200, [
    { id: 1, name: "AgentBoard", key: "AB" },
    { id: 2, name: "Transport Layer Security", key: "TLS" },
  ]));
  assert.equal(answer.url, "/api/products");
  assert.deepEqual(keys, ["AB", "TLS"]);
});

test("skips products without a key and anything that isn't one", async () => {
  const keys = await loadTeamProductKeys(answer(200, [
    { id: 1, key: null },
    { id: 2 },
    { id: 3, key: "" },
    { id: 4, key: 7 },
    null,
    { id: 5, key: "UTC" },
  ]));
  assert.deepEqual(keys, ["UTC"]);
});

test("a failed or malformed load gives no keys", async () => {
  assert.deepEqual(await loadTeamProductKeys(answer(500, { error: "boom" })), []);
  assert.deepEqual(await loadTeamProductKeys(answer(401, { error: "Unauthorized" })), []);
  assert.deepEqual(await loadTeamProductKeys(answer(200, { error: "not a list" })), []);
  assert.deepEqual(await loadTeamProductKeys(async () => { throw new TypeError("Failed to fetch"); }), []);
  assert.deepEqual(
    await loadTeamProductKeys(async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError("bad json"); } })),
    [],
  );
});
