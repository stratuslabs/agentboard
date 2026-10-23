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
