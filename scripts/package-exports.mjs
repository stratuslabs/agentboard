#!/usr/bin/env node
// The package.json "exports" map, generated from src/.
//
// Every module under src/ is importable as `@stratuslabs/agentboard-core/<path>`
// without src/ or its extension (`.../app/api/cards/route`,
// `.../lib/tenant`, `.../configure`). Stylesheets keep their extension
// (`.../app/globals.css`).
//
// Each target names its real file. TypeScript resolves an exports target only
// when it is a file with an extension, so a `"./*": "./src/*"` wildcard
// bundles but fails the consumer's type-check.
//
//   node scripts/package-exports.mjs           print the map
//   node scripts/package-exports.mjs --write   update package.json
//
// test/package-surface.test.mjs fails when package.json is out of date.

import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const MODULE = /\.(tsx?|js)$/;
const STYLE = /\.css$/;

function walk(dir) {
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? walk(path) : [path];
    });
}

export function packageExports(root) {
  const src = join(root, "src");
  const entries = [["./package.json", "./package.json"]];
  for (const file of walk(src)) {
    const rel = relative(src, file).split(sep).join("/");
    if (rel.endsWith(".d.ts")) continue;
    if (MODULE.test(rel)) entries.push([`./${rel.replace(MODULE, "")}`, `./src/${rel}`]);
    else if (STYLE.test(rel)) entries.push([`./${rel}`, `./src/${rel}`]);
  }
  const keys = new Set();
  for (const [key, target] of entries) {
    if (keys.has(key)) throw new Error(`Two files export as ${key} (one is ${target})`);
    keys.add(key);
  }
  return Object.fromEntries(entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === (await import("node:fs")).realpathSync(process.argv[1])) {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const map = packageExports(root);
  if (process.argv.includes("--write")) {
    const path = join(root, "package.json");
    const pkg = JSON.parse(readFileSync(path, "utf8"));
    pkg.exports = map;
    writeFileSync(path, JSON.stringify(pkg, null, 2) + "\n");
    console.log(`package.json exports: ${Object.keys(map).length} entries`);
  } else {
    console.log(JSON.stringify(map, null, 2));
  }
}
