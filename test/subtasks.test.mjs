// Sub-tasks are a checklist on a card: a title and a done flag. The API,
// the CLI and the app all go through these rules, so a sub-task the CLI
// accepts is one the app can show, and the other way round.
//
//   node --test test/

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_SUBTASK_TITLE,
  parseSubtaskCreate,
  parseSubtaskUpdate,
  revertSubtaskPatch,
  restoreSubtask,
  subtaskProgress,
} from "../src/lib/subtasks.js";

test("create needs a non-empty title and trims it", () => {
  assert.deepEqual(parseSubtaskCreate({ title: "  Write tests  " }), {
    ok: true,
    value: { title: "Write tests", done: false },
  });
  for (const title of [undefined, null, "", "   ", "\n\t"]) {
    const r = parseSubtaskCreate({ title });
    assert.equal(r.ok, false, `title ${JSON.stringify(title)} should be rejected`);
    assert.match(r.error, /title/);
  }
});

test("create rejects a body that is not an object", () => {
  for (const body of [null, undefined, "x", 3, []]) {
    assert.equal(parseSubtaskCreate(body).ok, false);
  }
});

test("create accepts done, but only as a boolean", () => {
  assert.deepEqual(parseSubtaskCreate({ title: "a", done: true }).value, { title: "a", done: true });
  for (const done of ["true", 1, 0, "yes", null]) {
    const r = parseSubtaskCreate({ title: "a", done });
    assert.equal(r.ok, false, `done ${JSON.stringify(done)} should be rejected`);
    assert.match(r.error, /done/);
  }
});

test("title must be a string and at most MAX_SUBTASK_TITLE characters", () => {
  assert.equal(parseSubtaskCreate({ title: 42 }).ok, false);
  assert.equal(parseSubtaskCreate({ title: "x".repeat(MAX_SUBTASK_TITLE) }).ok, true);
  const long = parseSubtaskCreate({ title: "x".repeat(MAX_SUBTASK_TITLE + 1) });
  assert.equal(long.ok, false);
  assert.match(long.error, new RegExp(String(MAX_SUBTASK_TITLE)));
});

test("a title is one line: inner newlines collapse to spaces", () => {
  assert.equal(parseSubtaskCreate({ title: "first\nsecond\r\n third" }).value.title, "first second third");
});

test("update takes title, done or both, and nothing else silently", () => {
  assert.deepEqual(parseSubtaskUpdate({ done: true }), { ok: true, value: { done: true } });
  assert.deepEqual(parseSubtaskUpdate({ title: " New " }), { ok: true, value: { title: "New" } });
  assert.deepEqual(parseSubtaskUpdate({ title: "t", done: false }), {
    ok: true,
    value: { title: "t", done: false },
  });
  const empty = parseSubtaskUpdate({});
  assert.equal(empty.ok, false);
  assert.match(empty.error, /title or done/);
  // An unknown field is an error rather than a no-op that reads as success.
  const unknown = parseSubtaskUpdate({ done: true, position: 3 });
  assert.equal(unknown.ok, false);
  assert.match(unknown.error, /position/);
});

test("update applies the same title and done rules as create", () => {
  assert.equal(parseSubtaskUpdate({ title: "  " }).ok, false);
  assert.equal(parseSubtaskUpdate({ done: "false" }).ok, false);
  assert.equal(parseSubtaskUpdate({ title: "x".repeat(MAX_SUBTASK_TITLE + 1) }).ok, false);
});

test("progress reads done/total, and nothing when a card has no sub-tasks", () => {
  assert.equal(subtaskProgress(0, 0), null);
  assert.equal(subtaskProgress(3, 0), "0/3");
  assert.equal(subtaskProgress(3, 2), "2/3");
  assert.equal(subtaskProgress(3, 3), "3/3");
  // Counts come from Postgres COUNT(), which node-postgres returns as strings.
  assert.equal(subtaskProgress("4", "1"), "1/4");
  assert.equal(subtaskProgress(null, null), null);
  assert.equal(subtaskProgress(undefined, undefined), null);
});

// The app updates the checklist optimistically. When one write fails, only that
// write is undone: a later edit that already succeeded must survive.
const item = (id, title, done, position) => ({ id, card_id: 1, title, done, position, created_at: "", updated_at: "" });

test("a failed update reverts only the fields it changed", () => {
  const before = item(1, "Schema", true, 0);
  const list = [item(1, "Schema", false, 0), item(2, "Routes", true, 1)];
  assert.deepEqual(revertSubtaskPatch(list, before, { done: false }), [item(1, "Schema", true, 0), item(2, "Routes", true, 1)]);
});

test("a failed update leaves a field alone once a later edit changed it again", () => {
  const before = item(1, "Schema", true, 0);
  // done was set false by the failed write, then the title by a later one
  const list = [item(1, "Schema v2", false, 0)];
  assert.deepEqual(revertSubtaskPatch(list, before, { done: false, title: "Schema v1" }), [item(1, "Schema v2", true, 0)]);
  // a later write flipped done again: keep it
  assert.deepEqual(revertSubtaskPatch([item(1, "Schema", true, 0)], item(1, "Schema", false, 0), { done: false }), [item(1, "Schema", true, 0)]);
});

test("a failed update of a sub-task that is gone changes nothing", () => {
  const list = [item(2, "Routes", true, 1)];
  assert.deepEqual(revertSubtaskPatch(list, item(1, "Schema", true, 0), { done: false }), list);
});

test("a failed delete puts the sub-task back in position order", () => {
  const list = [item(1, "a", false, 0), item(3, "c", false, 2)];
  assert.deepEqual(restoreSubtask(list, item(2, "b", true, 1)).map((s) => s.id), [1, 2, 3]);
  assert.deepEqual(restoreSubtask([], item(2, "b", true, 1)).map((s) => s.id), [2]);
  assert.deepEqual(restoreSubtask(list, item(4, "d", false, 3)).map((s) => s.id), [1, 3, 4]);
});

test("a failed delete does not duplicate a sub-task that came back", () => {
  const list = [item(1, "a", false, 0), item(2, "b", false, 1)];
  assert.deepEqual(restoreSubtask(list, item(2, "b", true, 1)), list);
});
