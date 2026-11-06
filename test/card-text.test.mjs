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

// AB-117: Postgres text can't hold a NUL character, so one that got through
// failed the write with "invalid byte sequence" and an HTTP 500. Every string
// a card write stores is checked, the ones with their own rules too.
const STORED_STRINGS = [...CARD_TEXT_FIELDS, "priority", "github_issue_url", "github_pr_url"];

test("a NUL character in any stored string is rejected, naming the field", () => {
  for (const field of STORED_STRINGS) {
    for (const value of ["\u0000", "a\u0000b", "ends with\u0000"]) {
      const err = checkCardText({ title: "T", [field]: value });
      assert.ok(err, `${field}=${JSON.stringify(value)} should be rejected`);
      assert.match(err, new RegExp(`^${field} can't contain a NUL character`));
    }
  }
});

test("other control characters and non-ASCII text still pass", () => {
  const text = "tab\there\nnewline \u0001\u001f\u007f é 😀  ";
  for (const field of STORED_STRINGS) {
    assert.equal(checkCardText({ title: "T", [field]: text }), null, field);
  }
});
