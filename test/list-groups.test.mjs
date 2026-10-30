// Product groups on Assigned to me, Today and Past Due (card 297): grouping,
// and the remembered collapsed state.
//
// Run: node --test test/list-groups.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { groupByProduct, normalizeCollapsed, toggleCollapsed, isCollapsed, replayChoices } from "../src/lib/list-groups.js";

const card = (id, product_id, product_name, extra = {}) => ({
  id, product_id, product_name, product_emoji: "📦", org_name: "Labs", ...extra,
});

test("groups by product id, in the order products first appear", () => {
  const cards = [card(1, 7, "Website"), card(2, 3, "Billing"), card(3, 7, "Website")];
  const groups = groupByProduct(cards);
  assert.deepEqual(groups.map((g) => g.key), ["product:7", "product:3"]);
  assert.deepEqual(groups[0].cards.map((c) => c.id), [1, 3]);
  assert.equal(groups[0].name, "Website");
  assert.equal(groups[0].emoji, "📦");
});

test("two products with the same name stay apart and are labeled by org", () => {
  const cards = [card(1, 7, "Website", { org_name: "Northwind" }), card(2, 9, "Website", { org_name: "Acme" }), card(3, 4, "Billing")];
  const groups = groupByProduct(cards);
  assert.equal(groups.length, 3);
  assert.equal(groups[0].org, "Northwind");
  assert.equal(groups[1].org, "Acme");
  assert.equal(groups[2].org, undefined, "an unambiguous name gets no org label");
});

test("a card without product_id still groups, by name", () => {
  const groups = groupByProduct([{ id: 1, product_name: "Website", product_emoji: "🌐" }, { id: 2, product_name: "Website", product_emoji: "🌐" }]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].cards.length, 2);
});

test("empty list has no groups", () => {
  assert.deepEqual(groupByProduct([]), []);
});

test("toggle collapses, then expands, per list", () => {
  let state = {};
  state = toggleCollapsed(state, "today", "product:7");
  assert.equal(isCollapsed(state, "today", "product:7"), true);
  assert.equal(isCollapsed(state, "assigned", "product:7"), false, "lists are independent");
  state = toggleCollapsed(state, "today", "product:7");
  assert.equal(isCollapsed(state, "today", "product:7"), false);
  assert.deepEqual(state, {}, "an empty list entry is dropped");
});

test("toggle never changes its input", () => {
  const before = { today: ["product:1"] };
  const frozen = JSON.parse(JSON.stringify(before));
  const after = toggleCollapsed(before, "today", "product:2");
  assert.deepEqual(before, frozen);
  assert.deepEqual(after.today, ["product:1", "product:2"]);
});

test("a stored value that isn't the right shape reads as nothing collapsed", () => {
  for (const bad of [null, undefined, 3, "x", [], ["today"], { today: "product:1" }, { today: [1, null] }]) {
    const state = normalizeCollapsed(bad);
    assert.equal(isCollapsed(state, "today", "product:1"), false, JSON.stringify(bad));
  }
  assert.deepEqual(normalizeCollapsed({ today: ["product:1", 2, "product:1"], x: "y" }), { today: ["product:1"] });
});

test("replaying early clicks keeps the server's other collapsed groups", () => {
  const server = { today: ["product:2"], assigned: ["product:5"] };
  const out = replayChoices(server, [["today", "product:1", true]]);
  assert.deepEqual(out, { today: ["product:2", "product:1"], assigned: ["product:5"] });
  assert.deepEqual(server, { today: ["product:2"], assigned: ["product:5"] });
});

test("an early click replays the state the user chose, not a flip (#76 review)", () => {
  // The local cache showed product:1 collapsed, the server has it expanded, and
  // the user clicked to expand it: it stays expanded.
  assert.deepEqual(replayChoices({}, [["today", "product:1", false]]), {});
  // Server has it collapsed, user chose collapsed: still collapsed, once.
  assert.deepEqual(replayChoices({ today: ["product:1"] }, [["today", "product:1", true]]), { today: ["product:1"] });
});

test("the last early click for a group wins", () => {
  const server = { today: ["product:2"] };
  assert.deepEqual(replayChoices(server, [["today", "product:1", true], ["today", "product:1", false]]), server);
  assert.deepEqual(replayChoices(server, [["today", "product:2", false], ["today", "product:2", true]]), server);
  assert.deepEqual(replayChoices(server, []), server);
});
