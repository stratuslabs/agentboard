// A card's text fields must arrive as text. An older CLI sent
// `description: true` when a description began with `--`, and the API saved
// the word "true" in place of the description, with no error (card 22).
// The API now rejects any non-string text field, whoever sent it.
//
//   node --test test/

import { test } from "node:test";
import assert from "node:assert/strict";
import { CARD_TEXT_FIELDS, checkCardText } from "../src/lib/card-text.js";

const D = "Intro\n--column todo moves it\n  --priority high\nend";

test("strings pass, including ones with -- lines and empty strings", () => {
  assert.equal(checkCardText({ title: "T", description: D }), null);
  assert.equal(checkCardText({ title: "--x", description: "--priority high" }), null);
  assert.equal(checkCardText({ description: "", labels: "", assignee: "Remy" }), null);
});

test("absent fields pass; the route decides what is required", () => {
  assert.equal(checkCardText({}), null);
  assert.equal(checkCardText({ column_id: 3, position: 2 }), null);
});

test("null clears an optional field but never the title", () => {
  assert.equal(checkCardText({ description: null, labels: null, assignee: null }), null);
  assert.match(checkCardText({ title: null }), /title must be a string/);
});

test("every non-string value is rejected for every text field, naming it", () => {
  const bad = [true, false, 0, 42, [], ["a"], {}, { text: "x" }];
  for (const field of CARD_TEXT_FIELDS) {
    for (const value of bad) {
      const err = checkCardText({ [field]: value });
      assert.ok(err, `${field}=${JSON.stringify(value)} should be rejected`);
      assert.match(err, new RegExp(`^${field} must be a string`));
      assert.match(err, new RegExp(`got ${Array.isArray(value) ? "array" : typeof value}`));
    }
  }
});

test("the boolean an old CLI sent gets a hint about the cause", () => {
  assert.match(checkCardText({ description: true }), /update to 0\.9\.1 or later/);
});

test("a body that is not an object is rejected", () => {
  for (const body of [null, "x", 1, []]) {
    assert.match(checkCardText(body), /JSON object/);
  }
});
