// A product's default board is the board agents land on when they don't name
// one. PATCH /api/products/:id takes `default_board_id`: a board id, or null to
// clear it. Anything else is a 400, never a silent no-op.
//
//   node --test test/

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDefaultBoardId } from "../src/lib/default-board.js";

test("absent means leave it alone", () => {
  assert.deepEqual(parseDefaultBoardId(undefined), { present: false });
});

test("null clears the default", () => {
  assert.deepEqual(parseDefaultBoardId(null), { present: true, value: null });
});

test("a positive integer id is accepted", () => {
  assert.deepEqual(parseDefaultBoardId(12), { present: true, value: 12 });
});

test("anything else is an error, not a guess", () => {
  for (const bad of ["12", "", 0, -1, 1.5, NaN, true, {}, []]) {
    const r = parseDefaultBoardId(bad);
    assert.equal(r.present, true, String(bad));
    assert.match(r.error, /default_board_id/, String(bad));
  }
});
