// `npm run db:setup` (scripts/setup-db.js) must create every table the app's
// lazy `ensureTables()` (src/lib/db.ts) creates, or explicit setup leaves an
// incomplete schema that only the first app request papers over.
//
//   node --test test/

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const tables = (src) =>
  [...src.matchAll(/CREATE TABLE IF NOT EXISTS\s+([a-z_]+)/gi)].map((m) => m[1].toLowerCase()).sort();

test("db:setup creates every table ensureTables() creates", () => {
  const app = tables(read("src/lib/db.ts"));
  const setup = tables(read("scripts/setup-db.js"));
  assert.ok(app.length > 0, "found no tables in src/lib/db.ts");
  assert.deepEqual(app.filter((t) => !setup.includes(t)), []);
});
