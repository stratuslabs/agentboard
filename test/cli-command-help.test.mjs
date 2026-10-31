// `agentboard <command> --help` prints that command's usage and the flags it
// accepts, so an agent doesn't have to guess at options (card 834). Before
// this, every --help printed the general help.
//
// Help needs no server: these run with AGENTBOARD_URL unset.
//
//   node --test test/

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../cli/agentboard.js", import.meta.url));
const { COMMAND_FLAGS } = createRequire(import.meta.url)(CLI);

const env = { ...process.env };
for (const k of Object.keys(env)) if (k.startsWith("AGENTBOARD_")) delete env[k];

function run(...args) {
  return new Promise((resolve) => {
    execFile(process.execPath, [CLI, ...args], { env }, (err, stdout, stderr) => {
      resolve({ code: err ? err.code : 0, stdout, stderr });
    });
  });
}

// A line only the general help prints.
const GENERAL = "Management Commands:";

test("task move --help prints task move's usage and flags, not the general help", async () => {
  const r = await run("task", "move", "--help");
  assert.equal(r.code, 0);
  assert.equal(r.stderr, "");
  assert.match(r.stdout, /^Usage: agentboard task move /);
  for (const f of ["--column", "--to-board", "--to-product", "--json", "--quiet"]) {
    assert.ok(r.stdout.includes(f), `missing ${f}:\n${r.stdout}`);
  }
  assert.ok(!r.stdout.includes(GENERAL), r.stdout);
});

test("help <command> prints the same as <command> --help", async () => {
  const a = await run("task", "move", "--help");
  const b = await run("help", "task", "move");
  assert.equal(b.code, 0);
  assert.equal(b.stdout, a.stdout);
});

test("simple commands get their own help too", async () => {
  const r = await run("list", "--help");
  assert.equal(r.code, 0);
  assert.match(r.stdout, /^Usage: agentboard list/);
  assert.ok(r.stdout.includes("--include-done"));
  assert.ok(r.stdout.includes("--fields"));
  assert.ok(!r.stdout.includes(GENERAL));
});

test("a command with no flags of its own says so", async () => {
  const r = await run("show", "--help");
  assert.equal(r.code, 0);
  assert.match(r.stdout, /^Usage: agentboard show <id>/);
  assert.ok(!r.stdout.includes(GENERAL));
});

test("--help wins over the command's other flags and needs no server", async () => {
  const r = await run("task", "move", "5", "--column", "todo", "--help");
  assert.equal(r.code, 0);
  assert.match(r.stdout, /^Usage: agentboard task move /);
});

test("every command's help names every flag it accepts", async () => {
  const keys = Object.keys(COMMAND_FLAGS);
  const results = await Promise.all(keys.map((k) => run(...k.split(" "), "--help")));
  keys.forEach((key, i) => {
    const { code, stdout } = results[i];
    assert.equal(code, 0, key);
    assert.ok(stdout.startsWith(`Usage: agentboard ${key}`), `${key}:\n${stdout}`);
    assert.ok(!stdout.includes(GENERAL), `${key} printed the general help`);
    for (const f of COMMAND_FLAGS[key]) {
      assert.match(stdout, new RegExp(`--${f}\\b`), `${key} help is missing --${f}`);
    }
  });
});

test("a command group lists its subcommands", async () => {
  const r = await run("task", "--help");
  assert.equal(r.code, 0);
  assert.match(r.stdout, /^Usage: agentboard task <subcommand>/);
  for (const sub of ["add", "list", "move", "update", "link", "attach"]) {
    assert.match(r.stdout, new RegExp(`^  agentboard task ${sub}\\b`, "m"), `missing task ${sub}`);
  }
  assert.ok(!r.stdout.includes(GENERAL));
});

test("an unknown subcommand in a group gets the group's help", async () => {
  const r = await run("task", "nope", "--help");
  assert.equal(r.code, 0);
  assert.match(r.stdout, /^Usage: agentboard task <subcommand>/);
});

test("unknown commands and bare --help still get the general help", async () => {
  for (const args of [["--help"], ["help"], [], ["nope", "--help"], ["help", "nope"]]) {
    const r = await run(...args);
    assert.equal(r.code, 0, args.join(" "));
    assert.ok(r.stdout.includes(GENERAL), `${args.join(" ")}:\n${r.stdout}`);
  }
});

test("the general help points at per-command help", async () => {
  const r = await run("--help");
  assert.match(r.stdout, /agentboard <command> --help/);
});

test("help covers exactly the commands that have flag lists", () => {
  const { COMMAND_HELP } = createRequire(import.meta.url)(CLI);
  assert.deepEqual(Object.keys(COMMAND_HELP).sort(), Object.keys(COMMAND_FLAGS).sort());
});

test("a command's --help wins over --version", async () => {
  for (const args of [["task", "move", "--help", "--version"], ["--version", "list", "--help"]]) {
    const r = await run(...args);
    assert.equal(r.code, 0, args.join(" "));
    assert.match(r.stdout, /^Usage: agentboard (task move|list)/, `${args.join(" ")}:\n${r.stdout}`);
  }
  // With no command, --version still prints the version, as before.
  const v = await run("--version");
  assert.match(v.stdout, /^agentboard \d+\.\d+\.\d+/);
});

// The --quiet row in a command's help, or null when there is none.
function quietRow(stdout) {
  const line = stdout.split("\n").find((l) => /^\s+--quiet\b/.test(l));
  return line ? line.replace(/^\s+--quiet\s+/, "") : null;
}

test("--quiet is described as it behaves for each command", async () => {
  // These print something other than ids with --quiet.
  const notes = quietRow((await run("notes", "--help")).stdout);
  assert.ok(notes && !/^IDs only$/.test(notes) && /description/.test(notes), `notes: ${notes}`);
  const get = quietRow((await run("attachment", "get", "--help")).stdout);
  assert.ok(get && !/^IDs only$/.test(get) && /content/.test(get) && /--out/.test(get), `attachment get: ${get}`);

  // These answer with no ids at all, so the help doesn't offer --quiet.
  const noIds = Object.keys(COMMAND_FLAGS).filter(
    (k) => / (remove|reorder)$/.test(k) || k === "settings" || k === "preferences"
  );
  assert.ok(noIds.length >= 12, noIds.join(", "));
  const results = await Promise.all(noIds.map((k) => run(...k.split(" "), "--help")));
  noIds.forEach((k, i) => assert.equal(quietRow(results[i].stdout), null, `${k} still offers --quiet`));

  // Commands that do print ids keep "IDs only".
  for (const k of ["list", "task move", "status", "subtask list", "board view"]) {
    assert.equal(quietRow((await run(...k.split(" "), "--help")).stdout), "IDs only", k);
  }
});
