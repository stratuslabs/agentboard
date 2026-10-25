// The release workflow's decisions, tested without npm or GitHub:
// which tags release the CLI, and which npm dist-tag a version gets.
//
//   node --test test/

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseCliTag, distTagFor, publishPlan, compareVersions } from "../scripts/cli-release.mjs";

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

const npm = (latest, extra = {}, versions = [latest]) => ({
  "dist-tags": { latest, ...extra },
  versions,
});

test("compareVersions follows semver precedence for prereleases", () => {
  assert.equal(compareVersions("1.0.0-beta.1", "1.0.0"), -1);
  assert.equal(compareVersions("1.0.0", "1.0.0-rc.1"), 1);
  assert.equal(compareVersions("1.0.0-beta.2", "1.0.0-beta.1"), 1);
  assert.equal(compareVersions("1.0.0-beta.10", "1.0.0-beta.9"), 1);
  assert.equal(compareVersions("1.0.0-alpha", "1.0.0-alpha.1"), -1);
  assert.equal(compareVersions("1.0.0-alpha.beta", "1.0.0-alpha.1"), 1);
  assert.equal(compareVersions("1.0.0-rc.1", "1.0.0-beta.11"), 1);
  assert.equal(compareVersions("1.0.0-beta.1", "1.0.0-beta.1"), 0);
});

test("distTagFor: a prerelease goes to next and never moves latest", () => {
  assert.equal(distTagFor("1.0.0-beta.1", npm("0.9.1")), "next");
  assert.equal(distTagFor("1.0.0-beta.2", npm("0.9.1", { next: "1.0.0-beta.1" })), "next");
});

test("distTagFor: an older prerelease than next is refused, so next never moves back", () => {
  const registry = npm("0.9.1", { next: "1.0.0-beta.2" });
  assert.throws(() => distTagFor("1.0.0-beta.1", registry), /next/);
});

test("distTagFor: a stable version above latest becomes latest", () => {
  assert.equal(distTagFor("0.10.0", npm("0.9.1")), "latest");
  assert.equal(distTagFor("1.0.0", npm("0.9.1")), "latest");
});

test("distTagFor: a patch to an older line does not replace latest", () => {
  assert.equal(distTagFor("0.9.2", npm("1.0.0")), "maintenance");
  assert.equal(distTagFor("0.9.3", npm("1.0.0", { maintenance: "0.9.2" })), "maintenance");
});

test("distTagFor: an older maintenance release than the current one is refused", () => {
  assert.throws(() => distTagFor("0.8.5", npm("1.0.0", { maintenance: "0.9.2" })), /maintenance/);
});

test("distTagFor: republishing the current latest version is refused", () => {
  // npm rejects it anyway; failing here names the real problem.
  assert.throws(() => distTagFor("0.9.1", npm("0.9.1")), /already/);
});

test("distTagFor: no latest on npm fails rather than guessing a first publish", () => {
  // agentboard is already on npm, so a missing latest means the lookup broke.
  assert.throws(() => distTagFor("0.10.0", { "dist-tags": {}, versions: [] }), /latest/);
  assert.throws(() => distTagFor("0.10.0", {}), /latest/);
  assert.throws(() => distTagFor("0.10.0", null), /latest/);
});

test("publishPlan skips a version that is already on npm", () => {
  assert.equal(publishPlan("0.9.0", npm("0.9.1", {}, ["0.9.0", "0.9.1"])), "skip");
  // npm view prints a lone version as a string, not a list.
  assert.equal(publishPlan("0.9.1", { "dist-tags": { latest: "0.9.1" }, versions: "0.9.1" }), "skip");
});

test("publishPlan otherwise returns the dist-tag", () => {
  assert.equal(publishPlan("0.10.0", npm("0.9.1", {}, ["0.9.0", "0.9.1"])), "latest");
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

function runWithStdin(args, input) {
  return new Promise((resolve) => {
    const child = execFile(process.execPath, [SCRIPT, ...args], (error, stdout, stderr) => {
      resolve({ code: error ? error.code : 0, stdout, stderr });
    });
    child.stdin.end(input);
  });
}

test("CLI: plan reads npm view JSON on stdin and prints skip or the dist-tag", async () => {
  const view = JSON.stringify(npm("0.9.1", {}, ["0.9.0", "0.9.1"]));
  const res = await runWithStdin(["plan", "1.0.0"], view);
  assert.equal(res.code, 0, res.stderr);
  assert.equal(res.stdout.trim(), "latest");
  const skip = await runWithStdin(["plan", "0.9.1"], view);
  assert.equal(skip.stdout.trim(), "skip");
});

test("CLI: plan fails on output that isn't npm view JSON", async () => {
  for (const input of ["", "npm error code E500", JSON.stringify({ error: { code: "E404" } })]) {
    const res = await runWithStdin(["plan", "1.0.0"], input);
    assert.equal(res.code, 1, input);
  }
});

test("CLI: runs when started through a symlinked path", async () => {
  // Otherwise it printed nothing and exited 0, which the workflow would read
  // as an empty dist-tag.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-release-"));
  try {
    fs.symlinkSync(path.dirname(SCRIPT), path.join(dir, "scripts"));
    const linked = path.join(dir, "scripts", path.basename(SCRIPT));
    const res = await new Promise((resolve) => {
      const child = execFile(process.execPath, [linked, "plan", "1.0.0"], (error, stdout, stderr) => {
        resolve({ code: error ? error.code : 0, stdout, stderr });
      });
      child.stdin.end(JSON.stringify(npm("0.9.1")));
    });
    assert.equal(res.code, 0, res.stderr);
    assert.equal(res.stdout.trim(), "latest");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI: unknown command exits 2", async () => {
  const res = await run(["nope"]);
  assert.equal(res.code, 2);
});
