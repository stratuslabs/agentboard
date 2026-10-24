// Human-readable card ids: each product has a short key (AB) and cards are
// numbered per product (AB-142). These cover the pure pieces: deriving a key
// from a product name, validating one someone typed, and telling a card
// reference (`142`, `AB-142`, `ab-142`) from something that is neither.
//
//   node --test test/

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  deriveProductKey,
  normalizeProductKey,
  parseCardRef,
  formatCardKey,
} from "../src/lib/card-keys.js";

test("a key comes from a product name's word initials and capitals", () => {
  assert.equal(deriveProductKey("AgentBoard"), "AB");
  assert.equal(deriveProductKey("OpenKB"), "OKB");
  assert.equal(deriveProductKey("Updates.Page"), "UP");
  assert.equal(deriveProductKey("developer tools"), "DT");
  assert.equal(deriveProductKey("Stratus Agent Runtime Core Tools Extra"), "SARCT");
});

test("a one-word lowercase name uses its first three letters", () => {
  assert.equal(deriveProductKey("marketing"), "MAR");
  assert.equal(deriveProductKey("Ops"), "OPS");
});

test("a key always starts with a letter and has at least two characters", () => {
  assert.equal(deriveProductKey("2026 Planning"), "P2P");
  assert.equal(deriveProductKey("x"), "XX");
  assert.equal(deriveProductKey("🚀"), "PRD");
  assert.equal(deriveProductKey("Café Menu"), "CM");
  for (const name of ["", "  ", "!!!", "9", "ünïcödé", "a-b-c-d-e-f-g"]) {
    assert.match(deriveProductKey(name), /^[A-Z][A-Z0-9]{1,9}$/, `for ${JSON.stringify(name)}`);
  }
});

test("a key already in use gets the lowest free number", () => {
  assert.equal(deriveProductKey("AgentBoard", new Set(["AB"])), "AB2");
  assert.equal(deriveProductKey("AgentBoard", new Set(["AB", "AB2", "AB3"])), "AB4");
  assert.equal(deriveProductKey("Ops", new Set(["AB"])), "OPS");
});

test("a typed key is uppercased and checked", () => {
  assert.deepEqual(normalizeProductKey("ab"), { key: "AB" });
  assert.deepEqual(normalizeProductKey(" Agt "), { key: "AGT" });
  assert.deepEqual(normalizeProductKey("A1"), { key: "A1" });
  for (const bad of ["", "A", "1A", "A-B", "ABCDEFGHIJK", "A B", 12, null, undefined]) {
    assert.ok("error" in normalizeProductKey(bad), `should reject ${JSON.stringify(bad)}`);
  }
});

test("a card reference is a numeric id or KEY-N", () => {
  assert.deepEqual(parseCardRef("142"), { id: 142 });
  assert.deepEqual(parseCardRef(142), { id: 142 });
  assert.deepEqual(parseCardRef("AB-142"), { key: "AB", number: 142 });
  assert.deepEqual(parseCardRef("ab-142"), { key: "AB", number: 142 });
  assert.deepEqual(parseCardRef("AB2-7"), { key: "AB2", number: 7 });
});

test("anything else is not a card reference", () => {
  for (const bad of [
    "", "0", "-1", "1.0", "0x10", "12abc", "AB-0", "AB-", "-142", "A-1",
    "AB-1.5", "AB--1", "1A-5", "AB-99999999999", "2147483648", "AB-2147483648",
    "AB 142", null, undefined, {}, [],
  ]) {
    assert.equal(parseCardRef(bad), null, `should reject ${JSON.stringify(bad)}`);
  }
});

test("a card key needs both a product key and a number", () => {
  assert.equal(formatCardKey("AB", 142), "AB-142");
  assert.equal(formatCardKey(null, 142), null);
  assert.equal(formatCardKey("AB", null), null);
});

test("every derived key reads back as a card reference prefix", () => {
  for (const name of ["AgentBoard", "OpenKB", "x", "🚀", "2026 Planning", "a b c d e f g h"]) {
    const key = deriveProductKey(name);
    assert.deepEqual(parseCardRef(`${key}-1`), { key, number: 1 });
    assert.deepEqual(normalizeProductKey(key), { key });
  }
});
