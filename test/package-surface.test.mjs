// The core is consumed by another Next app as a package (see
// test/consumer and docs/embedding.md). These checks keep
// the parts of that contract that are easy to break without noticing.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const sources = walk(join(ROOT, "src")).filter((f) => /\.(m?[jt]sx?)$/.test(f));

test("src imports nothing through the @/ alias", () => {
  // A consumer's bundler applies its own tsconfig paths, not ours, so `@/lib/x`
  // inside node_modules would resolve against the consumer's src/ (or fail).
  // Relative imports resolve the same in this repo and in a consumer.
  const offenders = sources.flatMap((file) =>
    readFileSync(file, "utf8")
      .split("\n")
      .map((line, i) => ({ line, n: i + 1 }))
      .filter(({ line }) => /(from\s+|import\(\s*|require\(\s*)["']@\//.test(line))
      .map(({ n }) => `${relative(ROOT, file)}:${n}`),
  );
  assert.deepEqual(offenders, []);
});

test("package.json exports match the generated map", async () => {
  const { packageExports } = await import("../scripts/package-exports.mjs");
  assert.deepEqual(pkg.exports, packageExports(ROOT), "run: node scripts/package-exports.mjs --write");
});

test("every export target exists and carries its extension", () => {
  // TypeScript only resolves an exports target that names a real file, so an
  // extensionless or wildcard target type-checks nowhere.
  for (const [key, target] of Object.entries(pkg.exports)) {
    assert.match(target, /\.(tsx?|js|css|json)$/, key);
    assert.ok(statSync(join(ROOT, target)).isFile(), `${key} -> ${target}`);
  }
});

test("the package exposes routes, pages, the layout and configure()", () => {
  for (const key of [
    "./app/layout",
    "./app/(board)/page",
    "./app/api/cards/route",
    "./app/api/cards/[id]/route",
    "./app/globals.css",
    "./configure",
    "./middleware",
  ]) {
    assert.ok(pkg.exports[key], key);
  }
});

test("the UI is adapted by composition, not by an edition file", () => {
  // A consuming app passes its sidebar slots and settings sections as props
  // to these components; there is no per-edition module to copy and edit.
  assert.equal(existsSync(join(ROOT, "src", "edition")), false, "src/edition is gone");
  const offenders = sources.filter((file) => /from\s+["'][^"']*\/edition(\/|["'])/.test(readFileSync(file, "utf8")));
  assert.deepEqual(offenders.map((f) => relative(ROOT, f)), []);
  for (const key of ["./components/BoardLayout", "./components/settings/SettingsShell", "./components/settings/sections"]) {
    assert.ok(pkg.exports[key], key);
  }
});

test("name, peer dependencies and published files", () => {
  // npm `agentboard` is the CLI (cli/), so the core needs its own name.
  assert.equal(pkg.name, "@stratuslabs/agentboard-core");
  // Never published from here until Dylan approves it; consumers pin a commit.
  assert.equal(pkg.private, true);
  for (const dep of ["next", "react", "react-dom"]) {
    assert.ok(pkg.peerDependencies?.[dep], `${dep} is a peer dependency`);
    assert.equal(pkg.dependencies?.[dep], undefined, `${dep} is not a direct dependency`);
    assert.ok(pkg.devDependencies?.[dep], `${dep} is a dev dependency for local runs`);
  }
  // The core ships its stylesheet as Tailwind source; the consumer compiles it.
  for (const dep of ["tailwindcss", "@tailwindcss/postcss"]) {
    assert.ok(pkg.peerDependencies?.[dep], `${dep} is a peer dependency`);
  }
  assert.ok(pkg.files.includes("src"));
});

// The consumer fixture is the working example a hosted wrapper copies, so it
// mounts every API route the core's UI calls, with the same methods. A
// section kept in the UI whose route isn't mounted fails with a 404 that the
// UI can't show (Codex on #58: settings and member edit/remove). Login and
// logout are left out: a consumer brings its own auth.
const CONSUMER_OWNS = new Set(["./app/api/auth/login/route", "./app/api/auth/logout/route"]);
const methodsOf = (text) =>
  new Set([
    ...[...text.matchAll(/export (?:async function|const) (GET|POST|PUT|PATCH|DELETE)\b/g)].map((m) => m[1]),
    ...[...text.matchAll(/export \{([^}]*)\} from/g)].flatMap((m) => m[1].split(",").map((s) => s.trim())),
  ].filter((m) => /^(GET|POST|PUT|PATCH|DELETE)$/.test(m)));

test("the consumer fixture mounts every core API route with the same methods", () => {
  const problems = [];
  for (const [key, target] of Object.entries(pkg.exports)) {
    if (!/^\.\/app\/api\/.*\/route$/.test(key) || CONSUMER_OWNS.has(key)) continue;
    const fixture = join(ROOT, "test", "consumer", key.slice(2) + ".ts");
    if (!existsSync(fixture)) {
      problems.push(`${key}: no ${relative(ROOT, fixture)}`);
      continue;
    }
    const want = [...methodsOf(readFileSync(join(ROOT, target), "utf8"))].sort().join(",");
    const text = readFileSync(fixture, "utf8");
    const got = [...methodsOf(text)].sort().join(",");
    if (want !== got) problems.push(`${key}: fixture exports ${got || "nothing"}, core exports ${want}`);
    if (!text.includes(`"@stratuslabs/agentboard-core/${key.slice(2)}"`)) problems.push(`${key}: fixture does not re-export from the package`);
  }
  assert.deepEqual(problems, []);
});
