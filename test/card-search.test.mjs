// Card search (card 295): the board's text filter and the Cmd+K quick search
// share one reading of what was typed. These cover the pure pieces: splitting
// a query into words, telling a card reference (AB-12, #12, 12) from text, and
// whether a card on the board matches.
//
//   node --test test/

import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./support/ts-loader.mjs", import.meta.url);
const { parseSearchQuery, cardMatchesSearch, escapeLike } = await import("../src/lib/card-search.ts");

const card = (over = {}) => ({
  id: 41,
  number: 12,
  key: "AB-12",
  title: "Fix login redirect",
  description: "Signed-out /c/<id> lands on / after login",
  labels: "bug, auth",
  ...over,
});

test("an empty or blank query has no terms and matches every card", () => {
  for (const q of ["", "   ", null, undefined]) {
    assert.deepEqual(parseSearchQuery(q), { terms: [], refs: [] }, String(q));
    assert.equal(cardMatchesSearch(card(), q), true, String(q));
  }
});

test("words are lowercased, deduplicated and capped", () => {
  assert.deepEqual(parseSearchQuery("  Login   LOGIN redirect ").terms, ["login", "redirect"]);
  const many = Array.from({ length: 20 }, (_, i) => `w${i}`).join(" ");
  assert.equal(parseSearchQuery(many).terms.length, 8);
  assert.equal(parseSearchQuery("x".repeat(500)).terms[0].length, 100);
});

test("card references are recognized: KEY-N in any case, #N and N", () => {
  assert.deepEqual(parseSearchQuery("ab-12").refs, [{ key: "AB", number: 12 }]);
  assert.deepEqual(parseSearchQuery("#41").refs, [{ id: 41 }]);
  assert.deepEqual(parseSearchQuery("41").refs, [{ id: 41 }]);
  assert.deepEqual(parseSearchQuery("login").refs, []);
  // Out of INTEGER range, or not a reference at all, never becomes one.
  assert.deepEqual(parseSearchQuery("99999999999").refs, []);
  assert.deepEqual(parseSearchQuery("#0").refs, []);
  assert.deepEqual(parseSearchQuery("a-1").refs, []);
});

test("text matches the title, description and labels, case-insensitively", () => {
  assert.equal(cardMatchesSearch(card(), "LOGIN"), true);
  assert.equal(cardMatchesSearch(card(), "lands on"), true, "description");
  assert.equal(cardMatchesSearch(card(), "auth"), true, "labels");
  assert.equal(cardMatchesSearch(card(), "logout"), false);
});

test("every word has to match, in any field and any order", () => {
  assert.equal(cardMatchesSearch(card(), "redirect fix"), true);
  assert.equal(cardMatchesSearch(card(), "redirect bug"), true, "title + label");
  assert.equal(cardMatchesSearch(card(), "redirect logout"), false);
});

test("a key matches that card exactly, not every card that starts with it", () => {
  assert.equal(cardMatchesSearch(card(), "AB-12"), true);
  assert.equal(cardMatchesSearch(card(), "ab-12"), true);
  assert.equal(cardMatchesSearch(card({ key: "AB-120", number: 120 }), "AB-12"), false);
  assert.equal(cardMatchesSearch(card({ key: "AB-1", number: 1 }), "AB-12"), false);
});

test("a key is built from the board's product key when the card has none", () => {
  const bare = card({ key: undefined });
  assert.equal(cardMatchesSearch(bare, "AB-12", "AB"), true);
  assert.equal(cardMatchesSearch(bare, "AB-12", "OKB"), false);
  assert.equal(cardMatchesSearch(bare, "AB-12"), false);
});

test("a number matches the card's id or its number in the product", () => {
  assert.equal(cardMatchesSearch(card(), "#41"), true, "id");
  assert.equal(cardMatchesSearch(card(), "41"), true, "id");
  assert.equal(cardMatchesSearch(card(), "12"), true, "number");
  assert.equal(cardMatchesSearch(card(), "#12"), true, "number");
  assert.equal(cardMatchesSearch(card(), "13"), false);
});

test("a reference-looking word still matches as text", () => {
  // "v2" isn't a reference; "2026" is, but a title can contain it too.
  assert.equal(cardMatchesSearch(card({ title: "Plan for 2026" }), "2026"), true);
  assert.equal(cardMatchesSearch(card({ title: "Ship OKB-3 support" }), "okb-3"), true);
});

test("missing fields don't throw", () => {
  const sparse = { id: 5, title: "Only a title" };
  assert.equal(cardMatchesSearch(sparse, "title"), true);
  assert.equal(cardMatchesSearch(sparse, "nothing"), false);
  assert.equal(cardMatchesSearch(sparse, "#5"), true);
});

test("LIKE wildcards in a word are matched literally on the server", () => {
  assert.equal(escapeLike("100%"), "100\\%");
  assert.equal(escapeLike("snake_case"), "snake\\_case");
  assert.equal(escapeLike("back\\slash"), "back\\\\slash");
  assert.equal(escapeLike("plain"), "plain");
});
