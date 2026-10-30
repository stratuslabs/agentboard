// The Today page can hide cards that are already Done (card 206). A card is
// Done when its column is named Done, in any case, which is the same rule the
// Past Due and Assigned views use on the server (LOWER(col.name) = 'done').
//
//   node --test test/

import { test } from "node:test";
import assert from "node:assert/strict";
import { isDoneColumn, withoutDone } from "../src/lib/done-cards.js";

test("a column named Done, in any case or with stray spaces, is done", () => {
  for (const name of ["Done", "done", "DONE", " Done "]) assert.equal(isDoneColumn(name), true, name);
});

test("other columns, including look-alikes, are not done", () => {
  for (const name of ["Todo", "In Review", "Done-ish", "Not done", "", null, undefined]) {
    assert.equal(isDoneColumn(name), false, String(name));
  }
});

const cards = [
  { id: 1, column_name: "Todo" },
  { id: 2, column_name: "Done" },
  { id: 3, column_name: "In Progress" },
  { id: 4, column_name: "done" },
];

test("hiding Done drops Done cards, keeps the rest in order and counts what it hid", () => {
  const { cards: shown, hidden } = withoutDone(cards, true);
  assert.deepEqual(shown.map((c) => c.id), [1, 3]);
  assert.equal(hidden, 2);
});

test("with hiding off, every card is shown and none are counted as hidden", () => {
  const { cards: shown, hidden } = withoutDone(cards, false);
  assert.deepEqual(shown.map((c) => c.id), [1, 2, 3, 4]);
  assert.equal(hidden, 0);
});

test("the input list is not changed", () => {
  const copy = cards.map((c) => ({ ...c }));
  withoutDone(cards, true);
  assert.deepEqual(cards, copy);
});

test("an empty list stays empty", () => {
  assert.deepEqual(withoutDone([], true), { cards: [], hidden: 0 });
});
