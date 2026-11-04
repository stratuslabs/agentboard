// The link the API puts on a card (`url`) uses the card's key, /c/AB-142,
// because that's what people see in the web app and can say back. A card
// without a key (a product that has none yet) links by its id, which /c/
// resolves too. The DB-backed routes are covered by card-url-db.test.mjs.
//
//   node --test test/

import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./support/ts-loader.mjs", import.meta.url);

const { cardUrl, withCardUrl } = await import("../src/lib/public-url.ts");

const ORIGIN = "https://board.example.com";
const request = (url = `${ORIGIN}/api/cards`) => new Request(url);

test("cardUrl links by whatever reference it is given", () => {
  assert.equal(cardUrl(ORIGIN, "AB-142"), `${ORIGIN}/c/AB-142`);
  assert.equal(cardUrl(ORIGIN, 1340), `${ORIGIN}/c/1340`);
});

test("a card the server already keyed links by that key", () => {
  const card = withCardUrl(request(), { id: 1340, key: "AB-105", number: 105, product_key: "AB" });
  assert.equal(card.url, `${ORIGIN}/c/AB-105`);
});

test("a cross-product view row builds the key from its product key and number", () => {
  // /api/cards/views sends cards.* plus product_key, but no key.
  const card = withCardUrl(request(), { id: 1340, number: 105, product_key: "AB" });
  assert.equal(card.url, `${ORIGIN}/c/AB-105`);
});

test("a board snapshot passes the board's product key", () => {
  const cards = withCardUrl(request(), [{ id: 1, number: 7 }, { id: 2, number: 8 }], "OKB");
  assert.deepEqual(cards.map((c) => c.url), [`${ORIGIN}/c/OKB-7`, `${ORIGIN}/c/OKB-8`]);
});

test("the card's own key beats the product key passed in", () => {
  const card = withCardUrl(request(), { id: 1, key: "AB-3", number: 3, product_key: "AB" }, "OKB");
  assert.equal(card.url, `${ORIGIN}/c/AB-3`);
});

test("a card with no key links by its id", () => {
  assert.equal(withCardUrl(request(), { id: 9, key: null }).url, `${ORIGIN}/c/9`);
  assert.equal(withCardUrl(request(), { id: 9, number: 4 }).url, `${ORIGIN}/c/9`, "a number alone isn't a key");
  assert.equal(withCardUrl(request(), { id: 9, product_key: "AB", number: null }).url, `${ORIGIN}/c/9`);
  assert.equal(withCardUrl(request(), { id: 9 }, null).url, `${ORIGIN}/c/9`);
});

test("anything that isn't a card passes through unchanged", () => {
  assert.equal(withCardUrl(request(), null), null);
  assert.deepEqual(withCardUrl(request(), { error: "Not found" }), { error: "Not found" });
  assert.deepEqual(withCardUrl(request(), []), []);
});
