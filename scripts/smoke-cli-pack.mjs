#!/usr/bin/env node
// Packs cli/ exactly as npm would publish it, installs the tarball into an
// empty directory and runs the installed binary. Catches a missing file in
// "files", a broken bin entry or a shebang problem before anything reaches
// npm. Needs no network: the CLI has no dependencies.
//
//   node scripts/smoke-cli-pack.mjs

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const cliDir = fileURLToPath(new URL("../cli/", import.meta.url));
const { name, version } = JSON.parse(fs.readFileSync(path.join(cliDir, "package.json"), "utf8"));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ab-cli-pack-"));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

function check(condition, message) {
  if (!condition) {
    process.stderr.write(`smoke-cli-pack: ${message}\n`);
    process.exit(1);
  }
}

try {
  const [packed] = JSON.parse(
    execFileSync(npm, ["pack", "--json", "--pack-destination", tmp], { cwd: cliDir, encoding: "utf8" }),
  );
  const files = packed.files.map((f) => f.path).sort();
  console.log(`packed ${packed.filename}: ${files.join(", ")}`);
  for (const required of ["LICENSE", "README.md", "agentboard.js", "package.json"]) {
    check(files.includes(required), `${required} is missing from the package`);
  }

  const project = path.join(tmp, "project");
  fs.mkdirSync(project);
  fs.writeFileSync(path.join(project, "package.json"), '{"private":true}\n');
  execFileSync(npm, ["install", "--no-audit", "--no-fund", "--offline", path.join(tmp, packed.filename)], {
    cwd: project,
    stdio: "inherit",
  });

  const bin = path.join(project, "node_modules", ".bin", process.platform === "win32" ? "agentboard.cmd" : "agentboard");
  check(fs.existsSync(bin), `the package installs no agentboard binary`);

  const env = { ...process.env, AGENTBOARD_URL: "http://127.0.0.1:9", AGENTBOARD_KEY: "" };
  const out = execFileSync(bin, ["--version"], { encoding: "utf8", env }).trim();
  check(out === `agentboard ${version}`, `--version printed "${out}", expected "agentboard ${version}"`);
  const help = execFileSync(bin, ["--help"], { encoding: "utf8", env });
  check(/Usage: agentboard/.test(help), `--help did not print usage`);

  console.log(`ok: ${name}@${version} installs from its tarball and runs`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
