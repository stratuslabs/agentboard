// Default boards get a Blocked column, so `agentboard status <id> blocked`
// works out of the box. The default column list lives in one module, and an
// install still on the old, untouched default setting is upgraded to the new
// one. A list someone edited is left alone.
//
//   node --test test/

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_COLUMNS,
  LEGACY_DEFAULT_COLUMNS,
  upgradeDefaultColumnsSetting,
} from "../src/lib/default-columns.js";
import { slugify } from "../src/lib/slug.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

test("default columns include Blocked, with the slug the CLI looks for", () => {
  const slugs = DEFAULT_COLUMNS.map((c) => slugify(c.name));
  assert.ok(slugs.includes("blocked"), slugs.join(", "));
});

test("every status the CLI documents has a default column", () => {
  const slugs = new Set(DEFAULT_COLUMNS.map((c) => slugify(c.name)));
  for (const s of ["backlog", "todo", "in-progress", "in-review", "done", "blocked"]) {
    assert.ok(slugs.has(s), s);
  }
});

test("Blocked sits between In Progress and In Review, and Done stays last", () => {
  const names = DEFAULT_COLUMNS.map((c) => c.name);
  assert.deepEqual(names, ["Backlog", "Todo", "In Progress", "Blocked", "In Review", "Done"]);
  for (const c of DEFAULT_COLUMNS) assert.match(c.color, /^#[0-9A-F]{6}$/);
});

test("the untouched old default is upgraded to the new list", () => {
  const stored = JSON.stringify(LEGACY_DEFAULT_COLUMNS);
  assert.deepEqual(JSON.parse(upgradeDefaultColumnsSetting(stored)), DEFAULT_COLUMNS);
});

test("an old default with different whitespace or key order still upgrades", () => {
  const stored = JSON.stringify(
    LEGACY_DEFAULT_COLUMNS.map((c) => ({ color: c.color, name: c.name })),
    null,
    2,
  );
  assert.deepEqual(JSON.parse(upgradeDefaultColumnsSetting(stored)), DEFAULT_COLUMNS);
});

test("an edited, current or unreadable setting is left alone", () => {
  const edited = [...LEGACY_DEFAULT_COLUMNS, { name: "QA", color: "#000000" }];
  const recolored = LEGACY_DEFAULT_COLUMNS.map((c, i) => (i === 0 ? { ...c, color: "#111111" } : c));
  for (const value of [
    JSON.stringify(edited),
    JSON.stringify(recolored),
    JSON.stringify(LEGACY_DEFAULT_COLUMNS.slice(1)),
    JSON.stringify(DEFAULT_COLUMNS),
    "[]",
    "not json",
    "null",
    "{}",
    "",
    undefined,
    null,
  ]) {
    assert.equal(upgradeDefaultColumnsSetting(value), null, String(value));
  }
});

// The list used to be copied into five files, and they drifted: a new board
// and a new product could get different columns. Only the shared module may
// spell it out now.
test("no other source file keeps its own copy of the default column list", () => {
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx|js|mjs)$/.test(name)) files.push(p);
    }
  };
  walk(join(ROOT, "src"));
  walk(join(ROOT, "scripts"));
  const copies = files
    .filter((p) => !p.endsWith(join("src", "lib", "default-columns.js")))
    .filter((p) => /name:\s*"In Review",\s*color:/.test(readFileSync(p, "utf8")))
    .map((p) => relative(ROOT, p));
  assert.deepEqual(copies, []);
});
