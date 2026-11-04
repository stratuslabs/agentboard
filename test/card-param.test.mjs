// The open card in the address bar: `?card=AB-105` for a card with a key, so a
// link copied from the browser reads the way the card does. `?card=1340` from
// before keys, and for a card without one, still opens the card.

import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./support/ts-loader.mjs", import.meta.url);

const { parseCardParam, cardParamValue, cardMatchesParam, withCardParam, boardCardPath, readCardParam, writeCardParam } =
  await import("../src/lib/cards.ts");

test("?card= takes a key, in any case, or a numeric id", () => {
  assert.deepEqual(parseCardParam("?card=AB-105"), { ref: "AB-105", full: false });
  assert.deepEqual(parseCardParam("?card=ab-105&view=full"), { ref: "ab-105", full: true });
  assert.deepEqual(parseCardParam("?board=61&card=OKB2-7"), { ref: "OKB2-7", full: false });
  assert.deepEqual(parseCardParam("?card=1340"), { ref: "1340", full: false });
  assert.deepEqual(parseCardParam("card=1340"), { ref: "1340", full: false });
});

test("anything else in ?card= is no card", () => {
  for (const s of [
    "", "?", "?card=", "?card=0", "?card=-1", "?card=1.5", "?card=1e3", "?card=abc", "?card=AB",
    "?card=AB-", "?card=AB-0", "?card=AB-01", "?card=A-1", "?card=1AB-2", "?card=AB-105x",
    "?card=AB-105-2", "?card=ABCDEFGHIJK-1", "?card=AB-12345678901", "?card=%3Cb%3E", "?card=AB%20-1",
  ]) {
    assert.equal(parseCardParam(s).ref, null, s);
  }
  assert.deepEqual(parseCardParam("?view=full"), { ref: null, full: true });
});

test("the address bar gets the card's key, or its id without one", () => {
  assert.equal(cardParamValue({ id: 1340, key: "AB-105" }), "AB-105");
  assert.equal(cardParamValue({ id: 9, number: 7 }, "OKB"), "OKB-7");
  assert.equal(cardParamValue({ id: 9, number: 7, product_key: "AB" }, "OKB"), "AB-7");
  assert.equal(cardParamValue({ id: 9 }, "AB"), "9");
  assert.equal(cardParamValue({ id: 9, number: null }, "AB"), "9");
});

test("a ?card= value picks out its card by id or by key", () => {
  const card = { id: 1340, number: 105 };
  assert.equal(cardMatchesParam(card, "1340", "AB"), true);
  assert.equal(cardMatchesParam(card, "AB-105", "AB"), true);
  assert.equal(cardMatchesParam(card, "ab-105", "AB"), true);
  assert.equal(cardMatchesParam({ id: 1340, key: "AB-105" }, "Ab-105"), true);
  // Neither the number alone nor a neighbor's key is this card.
  assert.equal(cardMatchesParam(card, "105", "AB"), false);
  assert.equal(cardMatchesParam(card, "AB-10", "AB"), false);
  assert.equal(cardMatchesParam(card, "AB-1050", "AB"), false);
  assert.equal(cardMatchesParam(card, "OKB-105", "AB"), false);
  // Without a key, only the id finds it.
  assert.equal(cardMatchesParam({ id: 1340 }, "AB-105"), false);
  assert.equal(cardMatchesParam({ id: 1340 }, "1340"), true);
  assert.equal(cardMatchesParam(card, null, "AB"), false);
});

test("writing ?card= keeps the rest of the URL", () => {
  assert.equal(withCardParam("http://x/labs/agentboard", "AB-105"), "http://x/labs/agentboard?card=AB-105");
  assert.equal(
    withCardParam("http://x/labs/agentboard?board=61#top", "AB-105", true),
    "http://x/labs/agentboard?board=61&card=AB-105&view=full#top"
  );
  assert.equal(withCardParam("http://x/labs/agentboard?card=1340&view=full", "AB-105"), "http://x/labs/agentboard?card=AB-105");
  assert.equal(withCardParam("http://x/labs/agentboard?card=AB-105&view=full&q=1", null, true), "http://x/labs/agentboard?q=1");
  assert.equal(withCardParam("http://x/a", 1340), "http://x/a?card=1340");
});

test("a permanent link lands on the board with the card's key", () => {
  const where = { org_slug: "labs", product_slug: "agentboard" };
  assert.equal(boardCardPath({ ...where, id: 1340, key: "AB-105" }), "/labs/agentboard?card=AB-105");
  assert.equal(boardCardPath({ ...where, id: 1340, key: null }), "/labs/agentboard?card=1340");
  assert.equal(boardCardPath({ org_slug: "a b", product_slug: "c/d", id: 2, key: "WG-2" }), "/a%20b/c%2Fd?card=WG-2");
});

const savedWindow = globalThis.window;
let replaced;
beforeEach(() => {
  replaced = [];
  const location = { href: "http://x/labs/agentboard?board=61", search: "?board=61" };
  globalThis.window = {
    location,
    history: {
      state: null,
      replaceState(_state, _title, url) {
        replaced.push(url);
        location.href = url;
        location.search = new URL(url).search;
      },
    },
  };
});
after(() => {
  globalThis.window = savedWindow;
});

test("opening and closing a card rewrites the address bar in place", () => {
  writeCardParam("AB-105", true);
  assert.deepEqual(readCardParam(), { ref: "AB-105", full: true });
  writeCardParam(null);
  assert.deepEqual(readCardParam(), { ref: null, full: false });
  assert.deepEqual(replaced, ["http://x/labs/agentboard?board=61&card=AB-105&view=full", "http://x/labs/agentboard?board=61"]);
});
