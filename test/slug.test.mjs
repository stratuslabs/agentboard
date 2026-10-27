// One slug rule for orgs, products, boards and columns (card 248).
//
// - A name makes its slug with slugify. An apostrophe is dropped rather than
//   turned into a hyphen: "Floyd's X" is floyds-x, not floyd-s-x.
// - Adding something whose name makes a slug a sibling already holds is a 409
//   naming the holder, never a silent duplicate or a 500.
// - Renaming an org, product or board keeps its slug, since URLs and agent
//   configs point at it. The new name still can't make a sibling's slug.
//
//   node --test test/

import { test } from "node:test";
import assert from "node:assert/strict";
import { legacySlugify, planSlugName, slugify, slugTaken, uniqueBySlug } from "../src/lib/slug.js";

const BOARD = { kind: "board", scope: "in this product" };
const rows = (...list) => list.map(([id, name, slug]) => ({ id, name, slug }));

test("slugify drops apostrophes instead of hyphenating them", () => {
  assert.equal(slugify("Floyd's X"), "floyds-x");
  assert.equal(slugify("Can't replicate"), "cant-replicate");
  assert.equal(slugify("Dylan’s board"), "dylans-board", "curly apostrophe");
  assert.equal(slugify("Rock 'n' roll"), "rock-n-roll");
  assert.equal(slugify("In Review"), "in-review");
  assert.equal(slugify("  Todo!! "), "todo");
  assert.equal(slugify("!!!"), "");
});

test("legacySlugify is the old rule, so slugs it made still count", () => {
  assert.equal(legacySlugify("Floyd's X"), "floyd-s-x");
  assert.equal(legacySlugify("In Review"), "in-review");
});

test("adding takes the name's slug when nothing in the scope holds it", () => {
  assert.deepEqual(planSlugName(BOARD, "  Floyd's X ", rows([1, "Development", "development"]), null), {
    ok: true,
    name: "Floyd's X",
    slug: "floyds-x",
  });
});

test("adding a name whose slug a sibling holds is a 409 naming the holder", () => {
  const siblings = rows([1, "Development", "development"], [2, "Ops", "ops"]);
  const plan = planSlugName(BOARD, "DEVELOPMENT", siblings, null);
  assert.equal(plan.ok, false);
  assert.equal(plan.status, 409);
  assert.match(plan.error, /board in this product already uses the slug 'development' \(Development\)/);
});

test("a slug made by the old rule still blocks the same name", () => {
  // Made before apostrophes were dropped: floyd-s-x, not floyds-x.
  const plan = planSlugName(BOARD, "Floyd's X", rows([1, "Floyd's X", "floyd-s-x"]), null);
  assert.equal(plan.ok, false);
  assert.equal(plan.status, 409);
  assert.match(plan.error, /'floyd-s-x' \(Floyd's X\)/);
});

test("a name with no letters or digits, or no name, is a 400", () => {
  for (const name of ["", "   ", "!!!", undefined, 42]) {
    const plan = planSlugName(BOARD, name, [], null);
    assert.equal(plan.ok, false, String(name));
    assert.equal(plan.status, 400, String(name));
    assert.match(plan.error, /^Board name/, String(name));
  }
});

test("renaming keeps the slug it already has", () => {
  const siblings = rows([1, "General", "general"], [2, "Ops", "ops"]);
  assert.deepEqual(planSlugName(BOARD, "HQ", siblings, 1), { ok: true, name: "HQ", slug: "general" });
});

test("renaming to a name whose slug another sibling holds is a 409", () => {
  const siblings = rows([1, "General", "general"], [2, "Ops", "ops"]);
  const plan = planSlugName(BOARD, "OPS", siblings, 1);
  assert.equal(plan.ok, false);
  assert.equal(plan.status, 409);
  assert.match(plan.error, /'ops' \(Ops\)/);
});

test("renaming to its own name in other casing is fine", () => {
  const siblings = rows([1, "General", "general"], [2, "Ops", "ops"]);
  assert.deepEqual(planSlugName(BOARD, "GENERAL", siblings, 1), { ok: true, name: "GENERAL", slug: "general" });
});

test("a rename never returns the slug of a renamed sibling", () => {
  // Board 2 was renamed from General to Ops and kept `general`. A new board
  // called General would collide with it, so it's refused, not duplicated.
  const siblings = rows([1, "Development", "development"], [2, "Ops", "general"]);
  const plan = planSlugName(BOARD, "General", siblings, null);
  assert.equal(plan.status, 409);
  assert.match(plan.error, /'general' \(Ops\)/);
});

test("a name another sibling already has is a 409, even when its slug differs", () => {
  // Renamed from General to HQ, it kept `general`; a new "hq" would make a
  // second board called HQ.
  const plan = planSlugName(BOARD, "hq", rows([1, "HQ", "general"]), null);
  assert.equal(plan.status, 409);
  assert.match(plan.error, /board in this product is already called HQ \(slug 'general'\)/);
});

test("a custom slug maker is used, such as the org rule for reserved paths", () => {
  const orgSlug = (name) => (slugify(name) === "c" ? "c-org" : slugify(name));
  const plan = planSlugName({ kind: "organization", scope: "in this team" }, "C", [], null, orgSlug);
  assert.deepEqual(plan, { ok: true, name: "C", slug: "c-org" });
});

test("slugTaken only matches stored slugs, never a sibling's name", () => {
  const siblings = [{ id: 1, name: "HQ", slug: "general" }];
  assert.equal(slugTaken(ORG_LIKE, "hq", siblings), null, "HQ's name makes hq, but nobody holds it");
  const r = slugTaken(ORG_LIKE, "general", siblings);
  assert.equal(r && r.status, 409);
  assert.match(r.error, /already uses the slug 'general' \(HQ\)/);
});

const ORG_LIKE = { kind: "organization", scope: "in this workspace" };

test("uniqueBySlug keeps the first of each slug and drops names with none", () => {
  const kept = uniqueBySlug(["Can't", "Cant", "TODO", "todo", "!!!", "Done"], (n) => n);
  assert.deepEqual(kept, [
    { item: "Can't", slug: "cant" },
    { item: "TODO", slug: "todo" },
    { item: "Done", slug: "done" },
  ]);
});
