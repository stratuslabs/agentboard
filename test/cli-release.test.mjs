// The release workflow's decisions, tested without npm or GitHub:
// which tags release the CLI, and which npm dist-tag a version gets.
//
//   node --test test/

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseCliTag, distTagFor, compareVersions } from "../scripts/cli-release.mjs";

const SCRIPT = fileURLToPath(new URL("../scripts/cli-release.mjs", import.meta.url));

test("parseCliTag accepts cli-v<semver> and returns the version", () => {
  assert.equal(parseCliTag("cli-v0.9.1"), "0.9.1");
  assert.equal(parseCliTag("cli-v1.0.0"), "1.0.0");
  assert.equal(parseCliTag("cli-v1.2.0-beta.1"), "1.2.0-beta.1");
});

test("parseCliTag rejects anything else", () => {
  for (const tag of ["v0.9.1", "cli-0.9.1", "cli-v0.9", "cli-v01.0.0", "cli-v1.0.0 ", "cli-v1.0.0+build", "core-v1.0.0", ""]) {
    assert.throws(() => parseCliTag(tag), /cli-v/, tag);
  }
});

test("compareVersions orders stable versions numerically, not as strings", () => {
  assert.equal(compareVersions("0.10.0", "0.9.1"), 1);
  assert.equal(compareVersions("0.9.1", "0.10.0"), -1);
  assert.equal(compareVersions("1.0.0", "1.0.0"), 0);
  assert.equal(compareVersions("2.0.0", "10.0.0"), -1);
});

test("distTagFor: a prerelease goes to next and never moves latest", () => {
  assert.equal(distTagFor("1.0.0-beta.1", "0.9.1"), "next");
  assert.equal(distTagFor("0.1.0-rc.1", null), "next");
});

test("distTagFor: a stable version above latest becomes latest", () => {
  assert.equal(distTagFor("0.10.0", "0.9.1"), "latest");
  assert.equal(distTagFor("1.0.0", "0.9.1"), "latest");
});

test("distTagFor: the first publish becomes latest", () => {
  assert.equal(distTagFor("0.9.1", null), "latest");
});

test("distTagFor: a patch to an older line does not replace latest", () => {
  assert.equal(distTagFor("0.9.2", "1.0.0"), "maintenance");
});

test("distTagFor: republishing the current latest version is refused", () => {
  // npm rejects it anyway; failing here names the real problem.
  assert.throws(() => distTagFor("0.9.1", "0.9.1"), /already/);
});

function run(args) {
  return new Promise((resolve) => {
    execFile(process.execPath, [SCRIPT, ...args], (error, stdout, stderr) => {
      resolve({ code: error ? error.code : 0, stdout, stderr });
    });
  });
}

test("CLI: check-tag passes when the tag matches cli/package.json", async () => {
  const { version } = (await import("../cli/package.json", { with: { type: "json" } })).default;
  const res = await run(["check-tag", `cli-v${version}`]);
  assert.equal(res.code, 0, res.stderr);
  assert.equal(res.stdout.trim(), version);
});

test("CLI: check-tag fails when the tag and cli/package.json disagree", async () => {
  const res = await run(["check-tag", "cli-v99.0.0"]);
  assert.equal(res.code, 1);
  assert.match(res.stderr, /cli\/package\.json/);
});

test("CLI: dist-tag prints the tag for a version", async () => {
  const res = await run(["dist-tag", "1.0.0", "0.9.1"]);
  assert.equal(res.code, 0, res.stderr);
  assert.equal(res.stdout.trim(), "latest");
  const first = await run(["dist-tag", "1.0.0", ""]);
  assert.equal(first.stdout.trim(), "latest");
});

test("CLI: unknown command exits 2", async () => {
  const res = await run(["nope"]);
  assert.equal(res.code, 2);
});
