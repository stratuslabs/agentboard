#!/usr/bin/env node
// Decisions the release workflow (.github/workflows/release.yml) makes about
// the npm CLI, kept here so they can be tested. No dependencies.
//
//   node scripts/cli-release.mjs check-tag cli-v0.10.0
//     Prints the version if the tag matches cli/package.json; exits 1 if not.
//   node scripts/cli-release.mjs dist-tag 0.10.0 <current latest on npm, or "">
//     Prints the npm dist-tag to publish under: latest, next or maintenance.
//
// See RELEASING.md.

import fs from "node:fs";
import { fileURLToPath } from "node:url";

// Plain MAJOR.MINOR.PATCH with an optional prerelease. No build metadata:
// npm ignores it, so two tags could name the same npm version.
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

export function parseCliTag(tag) {
  const match = /^cli-v(.*)$/.exec(tag);
  if (!match || !SEMVER.test(match[1])) {
    throw new Error(`"${tag}" is not a CLI release tag. Use cli-v<version>, e.g. cli-v0.10.0`);
  }
  return match[1];
}

function parts(version) {
  const m = SEMVER.exec(version);
  if (!m) throw new Error(`"${version}" is not a version`);
  return { nums: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ?? null };
}

// Compares MAJOR.MINOR.PATCH only. Callers never compare two prereleases.
export function compareVersions(a, b) {
  const x = parts(a).nums;
  const y = parts(b).nums;
  for (let i = 0; i < 3; i++) {
    if (x[i] !== y[i]) return x[i] > y[i] ? 1 : -1;
  }
  return 0;
}

// latest: what `npm install -g agentboard` gets, so only the highest stable.
// next: prereleases, never installed by default.
// maintenance: a fix to an older line, published without replacing latest.
export function distTagFor(version, currentLatest) {
  if (parts(version).pre) return "next";
  if (!currentLatest) return "latest";
  const cmp = compareVersions(version, currentLatest);
  if (cmp === 0) throw new Error(`${version} is already the latest version on npm`);
  return cmp > 0 ? "latest" : "maintenance";
}

function main(argv) {
  const [command, ...args] = argv;
  if (command === "check-tag") {
    const version = parseCliTag(args[0] ?? "");
    const pkgPath = fileURLToPath(new URL("../cli/package.json", import.meta.url));
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    if (pkg.version !== version) {
      throw new Error(`Tag ${args[0]} doesn't match cli/package.json version ${pkg.version}`);
    }
    return version;
  }
  if (command === "dist-tag") {
    return distTagFor(args[0] ?? "", args[1] || null);
  }
  process.stderr.write("usage: cli-release.mjs check-tag <tag> | dist-tag <version> <current-latest>\n");
  process.exit(2);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.stdout.write(`${main(process.argv.slice(2))}\n`);
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  }
}
