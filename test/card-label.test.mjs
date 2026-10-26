// How a card names itself in the UI: its readable key (AB-142) when it has
// one, the internal #id when it doesn't (a product with no key yet, an older
// server that sends no number), and a permanent link that uses the same.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./support/ts-loader.mjs", import.meta.url);

const { cardKey, cardLabel, cardLink, cardTitle } = await import("../src/lib/cards.ts");

test("the server's key wins over anything computed", () => {
  assert.equal(cardKey({ id: 9, key: "AB-142", number: 3, product_key: "OKB" }, "XY"), "AB-142");
});

test("a key comes from the card's product key and number", () => {
  assert.equal(cardKey({ id: 9, number: 142, product_key: "AB" }), "AB-142");
});

test("on a board the product key is passed in", () => {
  assert.equal(cardKey({ id: 9, number: 7 }, "OKB"), "OKB-7");
});

test("the card's own product key beats the board's", () => {
  // A row from a cross-product view names its own product.
  assert.equal(cardKey({ id: 9, number: 7, product_key: "AB" }, "OKB"), "AB-7");
});

test("no number or no product key means no key", () => {
  assert.equal(cardKey({ id: 9, number: null }, "AB"), null);
  assert.equal(cardKey({ id: 9 }, "AB"), null);
  assert.equal(cardKey({ id: 9, number: 4 }), null);
  assert.equal(cardKey({ id: 9, number: 4, product_key: null }, null), null);
  assert.equal(cardKey({ id: 9, number: 4 }, ""), null);
});

test("the label falls back to the internal id", () => {
  assert.equal(cardLabel({ id: 9, number: 142 }, "AB"), "AB-142");
  assert.equal(cardLabel({ id: 9 }), "#9");
});

test("the tab title leads with the key", () => {
  assert.equal(cardTitle({ id: 9, number: 142, title: "Fix login" }, "AB"), "AB-142 Fix login");
  assert.equal(cardTitle({ id: 9, title: "Fix login" }), "Fix login");
  assert.equal(cardTitle(null), undefined);
});

let savedWindow;
before(() => {
  savedWindow = globalThis.window;
  globalThis.window = { location: { origin: "https://board.example" } };
});
after(() => {
  globalThis.window = savedWindow;
});

test("the permanent link uses the key, or the id without one", () => {
  assert.equal(cardLink({ id: 9, number: 142 }, "AB"), "https://board.example/c/AB-142");
  assert.equal(cardLink({ id: 9 }), "https://board.example/c/9");
});
