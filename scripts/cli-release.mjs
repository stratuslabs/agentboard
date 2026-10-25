#!/usr/bin/env node
// Decisions the release workflow (.github/workflows/release.yml) makes about
// the npm CLI, kept here so they can be tested. No dependencies.
//
//   node scripts/cli-release.mjs check-tag cli-v0.10.0
//     Prints the version if the tag matches cli/package.json; exits 1 if not.
//   npm view agentboard dist-tags versions --json | node scripts/cli-release.mjs plan 0.10.0
//     Prints "skip" if 0.10.0 is already on npm, otherwise the dist-tag to
//     publish under: latest, next or maintenance. Exits 1 if the input isn't
//     what npm view prints, or if publishing would move a dist-tag backward.
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

// Semver precedence (semver.org, section 11): numbers numerically, a
// prerelease below its release, prerelease identifiers left to right.
export function compareVersions(a, b) {
  const x = parts(a);
  const y = parts(b);
  for (let i = 0; i < 3; i++) {
    if (x.nums[i] !== y.nums[i]) return x.nums[i] > y.nums[i] ? 1 : -1;
  }
  if (x.pre === y.pre) return 0;
  if (x.pre === null) return 1;
  if (y.pre === null) return -1;
  const xs = x.pre.split(".");
  const ys = y.pre.split(".");
  for (let i = 0; i < Math.max(xs.length, ys.length); i++) {
    if (xs[i] === undefined) return -1;
    if (ys[i] === undefined) return 1;
    if (xs[i] === ys[i]) continue;
    const xn = /^\d+$/.test(xs[i]);
    const yn = /^\d+$/.test(ys[i]);
    if (xn && yn) return Number(xs[i]) > Number(ys[i]) ? 1 : -1;
    if (xn !== yn) return xn ? -1 : 1;
    return xs[i] > ys[i] ? 1 : -1;
  }
  return 0;
}

// latest: what `npm install -g agentboard` gets, so only the highest stable.
// next: prereleases, never installed by default.
// maintenance: a fix to an older line, published without replacing latest.
//
// `registry` is what `npm view agentboard dist-tags versions --json` prints.
// Publishing moves the chosen tag to the new version, so a release that would
// move a tag backward is refused instead of guessed at.
export function distTagFor(version, registry) {
  const tags = registry?.["dist-tags"] ?? {};
  if (!tags.latest) {
    // agentboard is already on npm, so no latest means the lookup went wrong.
    throw new Error("npm reported no latest version for agentboard; refusing to guess a dist-tag");
  }
  const forward = (tag) => {
    const current = tags[tag];
    if (current && compareVersions(version, current) <= 0) {
      throw new Error(
        `${version} is not newer than ${tag} (${current}); publishing it would move ${tag} backward. ` +
          "Publish it by hand under another tag. See RELEASING.md.",
      );
    }
    return tag;
  };
  if (parts(version).pre) return forward("next");
  const cmp = compareVersions(version, tags.latest);
  if (cmp === 0) throw new Error(`${version} is already the latest version on npm`);
  return cmp > 0 ? "latest" : forward("maintenance");
}

// "skip" if the version is already on npm (a re-run after a publish), so a
// re-run never fails on npm's refusal to accept a version twice.
export function publishPlan(version, registry) {
  const versions = [registry?.versions ?? []].flat();
  if (versions.includes(version)) return "skip";
  return distTagFor(version, registry);
}

function parseRegistry(text) {
  let registry;
  try {
    registry = JSON.parse(text);
  } catch {
    throw new Error("expected the JSON from `npm view agentboard dist-tags versions --json` on stdin");
  }
  if (!registry || typeof registry !== "object" || registry.error || !registry["dist-tags"]) {
    throw new Error(`npm view didn't return agentboard's dist-tags: ${text.slice(0, 200)}`);
  }
  return registry;
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
  if (command === "plan") {
    return publishPlan(args[0] ?? "", parseRegistry(fs.readFileSync(0, "utf8")));
  }
  process.stderr.write("usage: cli-release.mjs check-tag <tag> | plan <version> < npm-view.json\n");
  process.exit(2);
}

// realpath: a symlinked checkout would otherwise skip main() and print nothing.
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.stdout.write(`${main(process.argv.slice(2))}\n`);
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  }
}
