// A card's due date (AB-114). The API used to hand any due_date string
// straight to Postgres, so `--due null` from the CLI came back as an HTTP 500
// ("invalid input syntax for type date"). checkDueDate now answers a value
// that isn't a date with a message the route returns as a 400, before
// anything is written. Postgres still decides which strings are dates, so
// every value that worked before still works.
//
//   node --test test/

import { test } from "node:test";
import assert from "node:assert/strict";
import { checkDueDate } from "../src/lib/due-date.js";

// Stands in for `SELECT $1::date`: throws what Postgres throws.
function pgError(code, message) {
  return Object.assign(new Error(message), { code });
}
async function parse(value) {
  if (/^\d{4}-\d{2}-\d{2}/.test(value) && !value.startsWith("2026-13")) return;
  if (value.startsWith("2026-13")) throw pgError("22008", "date/time field value out of range");
  throw pgError("22007", `invalid input syntax for type date: "${value}"`);
}

test("a body without due_date passes untouched, with no database call", async () => {
  let called = false;
  const body = { title: "T" };
  assert.equal(await checkDueDate(body, async () => { called = true; }), null);
  assert.deepEqual(body, { title: "T" });
  assert.equal(called, false);
});

test("null clears the date, and an empty string is read as null", async () => {
  const cleared = { due_date: null };
  assert.equal(await checkDueDate(cleared, parse), null);
  assert.equal(cleared.due_date, null);

  const empty = { due_date: "" };
  assert.equal(await checkDueDate(empty, parse), null);
  assert.equal(empty.due_date, null, "\"\" is stored as no date, as card creation already did");
});

test("a date Postgres reads passes and is kept as sent", async () => {
  for (const value of ["2026-11-01", "2026-11-01T12:00:00Z"]) {
    const body = { due_date: value };
    assert.equal(await checkDueDate(body, parse), null);
    assert.equal(body.due_date, value);
  }
});

test("a string that isn't a date gets a message naming the value", async () => {
  for (const value of ["null", "none", "soon", "2026-13-45", "  "]) {
    const err = await checkDueDate({ due_date: value }, parse);
    assert.ok(err, `${JSON.stringify(value)} should be refused`);
    assert.match(err, /^due_date /);
    assert.ok(err.includes(JSON.stringify(value)), `names ${JSON.stringify(value)}: ${err}`);
    assert.match(err, /2026-11-01/, "shows the expected format");
    assert.match(err, /null to clear/);
  }
});

test("a very long bad value is cut short in the message", async () => {
  const err = await checkDueDate({ due_date: "x".repeat(5000) }, parse);
  assert.ok(err.length < 200, `message is ${err.length} characters`);
});

test("a value that isn't a string or null is refused without a database call", async () => {
  for (const value of [true, false, 0, 20261101, [], {}]) {
    let called = false;
    const err = await checkDueDate({ due_date: value }, async () => { called = true; });
    assert.ok(err, `${JSON.stringify(value)} should be refused`);
    assert.match(err, /^due_date must be a date string/);
    assert.match(err, new RegExp(`got ${Array.isArray(value) ? "array" : typeof value}`));
    assert.equal(called, false);
  }
});

test("any data exception from the cast is the value's fault, so a 400", async () => {
  // The cast reads only this one value, so a class 22 error is about it:
  // 22021 is a NUL character in the text, 22P02 any other unreadable text.
  for (const code of ["22021", "22P02", "22009"]) {
    const err = await checkDueDate({ due_date: "2026-11-01\u0000" }, async () => { throw pgError(code, "bad"); });
    assert.match(err ?? "", /^due_date "2026-11-01\\u0000" is not a date/, code);
  }
});

test("a database failure that isn't about the date is not hidden as a 400", async () => {
  for (const code of ["57P01", "08006", "53300", "XX000", undefined]) {
    const down = async () => { throw pgError(code, `terminating connection (${code})`); };
    await assert.rejects(checkDueDate({ due_date: "2026-11-01" }, down), /terminating connection/, String(code));
  }
});
