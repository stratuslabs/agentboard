// Group by on Assigned to me, Today and Past Due (card 298): product, priority
// or none, remembered per list.
//
// Run: node --test test/list-group-by.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GROUPINGS, groupCards, groupByProduct, normalizeGrouping, groupingPrefKey, mergeGroupings,
} from "../src/lib/list-groups.js";

const card = (id, priority, product_id = 1, product_name = "Website") => ({
  id, priority, product_id, product_name, product_emoji: "📦", org_name: "Labs",
});

test("the offered groupings are product, priority and none, product first", () => {
  assert.deepEqual([...GROUPINGS], ["product", "priority", "none"]);
});

test("product grouping is the existing product groups", () => {
  const cards = [card(1, "low", 7, "Website"), card(2, "high", 3, "Billing"), card(3, "low", 7, "Website")];
  assert.deepEqual(groupCards(cards, "product"), groupByProduct(cards));
});

test("priority grouping orders urgent, high, medium, low and keeps card order inside a group", () => {
  const cards = [card(1, "low"), card(2, "high"), card(3, "urgent"), card(4, "high"), card(5, "medium")];
  const groups = groupCards(cards, "priority");
  assert.deepEqual(groups.map((g) => g.key), ["priority:urgent", "priority:high", "priority:medium", "priority:low"]);
  assert.deepEqual(groups.map((g) => g.name), ["Urgent", "High", "Medium", "Low"]);
  assert.deepEqual(groups[1].cards.map((c) => c.id), [2, 4]);
  assert.equal(groups[0].priority, "urgent", "the header can show the priority dot");
});

test("priority grouping leaves out empty priorities", () => {
  const groups = groupCards([card(1, "low"), card(2, "low")], "priority");
  assert.deepEqual(groups.map((g) => g.key), ["priority:low"]);
});

test("an unknown or missing priority gets its own group after low, not dropped", () => {
  const cards = [card(1, "someday"), card(2, "low"), card(3, ""), card(4, undefined)];
  const groups = groupCards(cards, "priority");
  assert.deepEqual(groups.map((g) => g.key), ["priority:low", "priority:someday", "priority:none"]);
  assert.deepEqual(groups.at(-1).cards.map((c) => c.id), [3, 4]);
  assert.equal(groups.at(-1).name, "No priority");
  assert.equal(groups.flatMap((g) => g.cards).length, cards.length, "every card is in a group");
});

test("none is one flat group with every card, in order", () => {
  const cards = [card(3, "low"), card(1, "high", 2, "Billing"), card(2, "urgent")];
  const groups = groupCards(cards, "none");
  assert.equal(groups.length, 1);
  assert.equal(groups[0].flat, true);
  assert.deepEqual(groups[0].cards.map((c) => c.id), [3, 1, 2]);
});

test("no cards means no groups, whatever the grouping", () => {
  for (const g of GROUPINGS) assert.deepEqual(groupCards([], g), []);
});

test("an unknown grouping falls back to product", () => {
  const cards = [card(1, "low", 7, "Website"), card(2, "high", 3, "Billing")];
  assert.deepEqual(groupCards(cards, "colour"), groupByProduct(cards));
  assert.equal(normalizeGrouping("priority"), "priority");
  assert.equal(normalizeGrouping("none"), "none");
  for (const bad of [undefined, null, "", "Priority", 3, {}, ["none"]]) assert.equal(normalizeGrouping(bad), "product");
});

test("each list stores its choice under its own preference key", () => {
  assert.equal(groupingPrefKey("today"), "agentboard-list-grouping:today");
  assert.notEqual(groupingPrefKey("today"), groupingPrefKey("assigned"));
});

test("server choices win, missing ones fall back to the default, and lists changed here are kept", () => {
  const local = { today: "none", assigned: "priority", "past-due": "priority" };
  const received = {
    "agentboard-list-grouping:today": "priority",
    "agentboard-list-grouping:assigned": "none",
    "agentboard-hide-done-today": true,
  };
  const touched = new Set(["agentboard-list-grouping:assigned"]);
  assert.deepEqual(mergeGroupings(local, received, touched), { today: "priority", assigned: "priority" });
});

test("a bad stored value on the server reads as the default", () => {
  assert.deepEqual(mergeGroupings({ today: "none" }, { "agentboard-list-grouping:today": "colour" }, new Set()), {});
});

test("mergeGroupings never changes its input", () => {
  const local = { today: "none" };
  const frozen = { ...local };
  mergeGroupings(local, { "agentboard-list-grouping:today": "priority" }, new Set());
  assert.deepEqual(local, frozen);
});
