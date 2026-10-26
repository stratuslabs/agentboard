// A column's slug follows its name. `agentboard status <id> todo` finds a
// column by slug, so a column renamed from "Todo" to "Can't replicate" must
// stop answering to `todo`, or cards land somewhere with a different meaning.
//
//   node --test test/

import { test } from "node:test";
import assert from "node:assert/strict";
import { slugify } from "../src/lib/slug.js";
import { columnSlugMatchesName, planColumnRename, planColumnReslug } from "../src/lib/column-slug.js";

const cols = (...list) => list.map(([id, name, slug]) => ({ id, name, slug }));

test("slugify keeps its rule, apart from dropping apostrophes (card 248)", () => {
  assert.equal(slugify("In Review"), "in-review");
  assert.equal(slugify("  Todo!! "), "todo");
  assert.equal(slugify("Can't replicate"), "cant-replicate");
  assert.equal(slugify("!!!"), "");
});

test("a slug matches its name, or its name with a -N collision suffix", () => {
  assert.equal(columnSlugMatchesName("todo", "Todo"), true);
  assert.equal(columnSlugMatchesName("todo-2", "Todo"), true);
  assert.equal(columnSlugMatchesName("todo", "Can't replicate"), false);
  assert.equal(columnSlugMatchesName("done", "Live"), false);
  assert.equal(columnSlugMatchesName("todo-x", "Todo"), false);
  // Made before apostrophes were dropped, and still what agents type.
  assert.equal(columnSlugMatchesName("can-t-replicate", "Can't replicate"), true);
  assert.equal(columnSlugMatchesName("can-t-replicate-2", "Can't replicate"), true);
  assert.equal(columnSlugMatchesName("cant-replicate", "Can't replicate"), true);
});

test("migration leaves slugs made before apostrophes were dropped", () => {
  const board = cols([1, "Can't replicate", "can-t-replicate"], [2, "Won't fix", "won-t-fix-2"], [3, "Done", "done"]);
  assert.deepEqual(planColumnReslug(board), [{ id: 2, from: "won-t-fix-2", to: "won-t-fix" }]);
});

test("a rename to a name another column already has is a 409, whatever its slug", () => {
  // Renamed from Todo to Doing before slugs followed names, and kept `todo`.
  const board = cols([1, "Doing", "todo"], [2, "Backlog", "backlog"]);
  const clash = planColumnRename(board, 2, "doing");
  assert.equal(clash.status, 409);
  assert.match(clash.error, /already called Doing \(slug 'todo'\)/);
});

test("renaming a column moves its slug to the new name", () => {
  const board = cols([1, "Todo", "todo"], [2, "Done", "done"]);
  assert.deepEqual(planColumnRename(board, 1, "Can't replicate"), {
    ok: true,
    name: "Can't replicate",
    slug: "cant-replicate",
  });
});

test("a rename that keeps the slug (case, spacing) keeps it", () => {
  const board = cols([1, "Todo", "todo"]);
  assert.deepEqual(planColumnRename(board, 1, "TODO"), { ok: true, name: "TODO", slug: "todo" });
});

test("a rename trims the name and rejects an empty one", () => {
  const board = cols([1, "Todo", "todo"]);
  assert.deepEqual(planColumnRename(board, 1, "  Ready  "), { ok: true, name: "Ready", slug: "ready" });
  for (const name of ["", "   ", null, 3]) {
    const r = planColumnRename(board, 1, name);
    assert.equal(r.ok, false, `name ${JSON.stringify(name)} should be rejected`);
    assert.equal(r.status, 400);
  }
});

test("a rename needs a name that makes a slug", () => {
  const r = planColumnRename(cols([1, "Todo", "todo"]), 1, "!!!");
  assert.equal(r.ok, false);
  assert.equal(r.status, 400);
  assert.match(r.error, /letter or number/);
});

test("a rename onto another column's slug fails loudly instead of sharing it", () => {
  const board = cols([1, "Todo", "todo"], [2, "Doing", "in-progress"], [3, "In Progress", "wip"]);
  const r = planColumnRename(board, 2, "In-Progress!");
  assert.deepEqual(r.ok, true, "slug in-progress is its own, so this is fine");
  const clash = planColumnRename(board, 1, "Wip");
  assert.equal(clash.ok, false);
  assert.equal(clash.status, 409);
  assert.match(clash.error, /wip/);
  assert.match(clash.error, /In Progress/);
});

test("migration re-slugs only columns whose slug no longer matches their name", () => {
  // Stellar's Bugs board: To do was renamed "Can't replicate" and kept `todo`.
  const board = cols([1, "Backlog", "backlog"], [2, "Can't replicate", "todo"], [3, "Done", "done"]);
  assert.deepEqual(planColumnReslug(board), [{ id: 2, from: "todo", to: "cant-replicate" }]);
});

test("migration frees slugs first, so a suffixed column can take its plain slug", () => {
  // Design has slug `todo`, Live has slug `done`, and a later column is named Todo.
  // The Todo column comes first here on purpose: order on the board must not matter.
  const board = cols([3, "Todo", "todo-2"], [1, "Design", "todo"], [2, "Live", "done"]);
  assert.deepEqual(planColumnReslug(board), [
    { id: 1, from: "todo", to: "design" },
    { id: 2, from: "done", to: "live" },
    { id: 3, from: "todo-2", to: "todo" },
  ]);
});

test("migration suffixes a slug another column already holds, and never repeats", () => {
  const board = cols([1, "Review", "review"], [2, "Review", "in-review"]);
  const plan = planColumnReslug(board);
  assert.deepEqual(plan, [{ id: 2, from: "in-review", to: "review-2" }]);
  const after = board.map((c) => ({ ...c, slug: plan.find((p) => p.id === c.id)?.to ?? c.slug }));
  assert.deepEqual(planColumnReslug(after), [], "a second run changes nothing");
});

test("migration leaves a column alone when its name makes no slug", () => {
  assert.deepEqual(planColumnReslug(cols([1, "!!!", "todo"])), []);
});
