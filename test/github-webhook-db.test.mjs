// GitHub App webhook handling (card 1000) against real Postgres: a merged PR
// moves the cards it is linked to into Done and writes a History line; a PR
// closed without merging only gets the line.
//
// - Matching is by the card's PR field, its card links, or a card URL on this
//   instance in the PR body, and only inside the team the delivering
//   installation is bound to. Another team's card with the same PR is never
//   touched, and an installation bound to no team touches nothing.
// - A redelivery (same X-GitHub-Delivery) does nothing the second time.
// - A card already in Done is left alone, with no line.
//
//   AGENTBOARD_TEST_DATABASE_URL=postgres://... node --test test/
//
// Skipped without it. Runs in a schema of its own, dropped at the end.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire, register } from "node:module";

const require = createRequire(import.meta.url);
const URL_VAR = "AGENTBOARD_TEST_DATABASE_URL";
const url = process.env[URL_VAR];
const skip = url ? false : `set ${URL_VAR} to run`;
const SCHEMA = `github_webhook_test_${process.pid}`;
const ORIGIN = "https://boards.example.test";
const INSTALL = 4242;
const OTHER_INSTALL = 5151;
const UNBOUND_INSTALL = 9999;

let gh;
let end;
let db;
let ours;
let theirs;
let deliveries = 0;

async function makeTeam(slug, { done = true } = {}) {
  const team = (await db.query("INSERT INTO teams (name, slug) VALUES ($1, $1) RETURNING id", [slug])).rows[0].id;
  const org = (
    await db.query("INSERT INTO organizations (team_id, name, slug) VALUES ($1, $2, $2) RETURNING id", [team, `${slug}-org`])
  ).rows[0].id;
  const product = (
    // Both teams use key WEB, so WEB-1 in a PR body must resolve inside the bound team.
    await db.query("INSERT INTO products (org_id, name, slug, key) VALUES ($1, 'Web', 'web', 'WEB') RETURNING id, key", [org])
  ).rows[0];
  const board = async (name, withDone) => {
    const id = (
      await db.query("INSERT INTO boards (product_id, name, slug) VALUES ($1, $2, lower($2)) RETURNING id", [product.id, name])
    ).rows[0].id;
    const names = ["Todo", "In Review", ...(withDone ? ["Done"] : [])];
    const cols = {};
    for (const [i, n] of names.entries()) {
      const slug = n.toLowerCase().replace(/ /g, "-");
      cols[slug] = (
        await db.query("INSERT INTO columns (board_id, name, slug, position) VALUES ($1, $2, $3, $4) RETURNING id", [id, n, slug, i])
      ).rows[0].id;
    }
    return { id, cols };
  };
  return { team, org, product, dev: await board("Dev", done), ops: await board("Ops", false) };
}

async function card(where, fields = {}) {
  const { rows } = await db.query(
    `INSERT INTO cards (column_id, title, description, github_pr_url, position)
     VALUES ($1, $2, $3, $4, 0) RETURNING id, number`,
    [where, fields.title ?? "A card", fields.description ?? "", fields.pr ?? null]
  );
  for (const link of fields.links ?? []) {
    await db.query("INSERT INTO card_links (card_id, url) VALUES ($1, $2)", [rows[0].id, link]);
  }
  return rows[0];
}

const read = async (id) =>
  (
    await db.query(
      "SELECT c.column_id, c.description, c.position, col.slug FROM cards c JOIN columns col ON col.id = c.column_id WHERE c.id = $1",
      [id]
    )
  ).rows[0];

function prEvent({ number, merged = true, body = "", repo = "acme/web", installation = INSTALL, action = "closed" }) {
  return {
    action,
    number,
    installation: { id: installation },
    repository: { full_name: repo },
    pull_request: {
      number,
      html_url: `https://github.com/${repo}/pull/${number}`,
      merged,
      merged_at: merged ? "2026-10-31T12:00:00Z" : null,
      closed_at: "2026-10-31T12:00:00Z",
      body,
    },
  };
}

function deliver(payload, { event = "pull_request", id } = {}) {
  return gh.handleGithubEvent({ event, deliveryId: id ?? `d-${process.pid}-${++deliveries}`, payload, origin: ORIGIN });
}

before(async () => {
  if (skip) return;
  const pg = require("pg");
  const BasePool = pg.Pool;
  pg.Pool = class ScopedPool extends BasePool {
    constructor(options) {
      super(options);
      this.on("connect", (client) => {
        client.query(`SET search_path TO ${SCHEMA}`).catch(() => {});
      });
    }
  };
  process.env.POSTGRES_URL = url;
  process.env.POSTGRES_POOL_MAX = process.env.TEST_POOL_MAX || "5";
  register("./support/ts-loader.mjs", import.meta.url);
  ({ end, db } = require("../src/lib/sql.js"));
  await db.query(`CREATE SCHEMA ${SCHEMA}`);
  const { initDb } = await import(new URL("../src/lib/db.ts", import.meta.url).href);
  await initDb();
  gh = await import(new URL("../src/lib/github-webhook.ts", import.meta.url).href);
  ours = await makeTeam("ours");
  theirs = await makeTeam("theirs");
  await gh.bindInstallation({ installationId: INSTALL, teamId: ours.team, accountLogin: "acme" });
  await gh.bindInstallation({ installationId: OTHER_INSTALL, teamId: theirs.team, accountLogin: "rival" });
});

after(async () => {
  if (skip || !end) return;
  await db.query(`DROP SCHEMA ${SCHEMA} CASCADE`);
  await end();
});

test("a merged PR moves the card with that PR to the end of Done and writes History", { skip }, async () => {
  const existing = await card(ours.dev.cols.done, { title: "already done" });
  const c = await card(ours.dev.cols["in-review"], {
    pr: "https://GitHub.com/Acme/Web/pull/10/files",
    description: "Ship it.\n\n**History:**\n- Oct 30: opened\n",
  });
  const r = await deliver(prEvent({ number: 10 }));
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.moved, [c.id]);
  const after = await read(c.id);
  assert.equal(after.slug, "done");
  const top = (await read(existing.id)).position;
  assert.ok(after.position > top, "lands after the cards already in Done");
  assert.equal(
    after.description,
    "Ship it.\n\n**History:**\n- Oct 30: opened\n- Oct 31: PR acme/web#10 merged; moved to Done (GitHub App) https://github.com/acme/web/pull/10"
  );
});

test("a card link to the PR matches too", { skip }, async () => {
  const c = await card(ours.dev.cols.todo, { links: ["https://github.com/acme/web/pull/11#issuecomment-1"] });
  await deliver(prEvent({ number: 11 }));
  assert.equal((await read(c.id)).slug, "done");
});

test("a card URL on this instance in the PR body matches, by id or key", { skip }, async () => {
  const byId = await card(ours.dev.cols.todo);
  const byKey = await card(ours.dev.cols.todo);
  const elsewhere = await card(ours.dev.cols.todo);
  const key = `${ours.product.key}-${byKey.number}`;
  const body = `Fixes ${ORIGIN}/ours-org/web/dev?card=${byId.id} and ${ORIGIN}/c/${key}.\nNot https://other.example/c/${elsewhere.id}. Closes #${elsewhere.id}`;
  const r = await deliver(prEvent({ number: 12, body }));
  assert.deepEqual(r.body.moved.sort(), [byId.id, byKey.id].sort());
  assert.equal((await read(elsewhere.id)).slug, "todo");
});

test("PR 13 does not match a card linked to PR 130", { skip }, async () => {
  const c = await card(ours.dev.cols.todo, { pr: "https://github.com/acme/web/pull/130" });
  const r = await deliver(prEvent({ number: 13 }));
  assert.deepEqual(r.body.moved, []);
  assert.equal((await read(c.id)).slug, "todo");
});

test("another team's card with the same PR is never touched", { skip }, async () => {
  const mine = await card(ours.dev.cols.todo, { pr: "https://github.com/acme/web/pull/14" });
  const foreign = await card(theirs.dev.cols.todo, { pr: "https://github.com/acme/web/pull/14" });
  // A body link to the other team's card by id resolves to nothing here.
  await deliver(prEvent({ number: 14, body: `${ORIGIN}/x?card=${foreign.id}` }));
  assert.equal((await read(mine.id)).slug, "done");
  const f = await read(foreign.id);
  assert.equal(f.slug, "todo");
  assert.equal(f.description, "");
});

test("an installation bound to no team touches nothing", { skip }, async () => {
  const c = await card(ours.dev.cols.todo, { pr: "https://github.com/acme/web/pull/15" });
  const r = await deliver(prEvent({ number: 15, installation: UNBOUND_INSTALL }));
  assert.equal(r.status, 200);
  assert.equal(r.body.outcome, "unbound");
  assert.equal((await read(c.id)).slug, "todo");
});

test("closed without merging: the card stays and gets a line", { skip }, async () => {
  const c = await card(ours.dev.cols["in-review"], { pr: "https://github.com/acme/web/pull/16", description: "Why." });
  const r = await deliver(prEvent({ number: 16, merged: false }));
  assert.deepEqual(r.body.moved, []);
  assert.deepEqual(r.body.noted, [c.id]);
  const after = await read(c.id);
  assert.equal(after.slug, "in-review");
  assert.equal(
    after.description,
    "Why.\n\n**History:**\n- Oct 31: PR acme/web#16 closed without merging (GitHub App) https://github.com/acme/web/pull/16"
  );
});

test("a card already in Done is left alone, with no line", { skip }, async () => {
  const c = await card(ours.dev.cols.done, { pr: "https://github.com/acme/web/pull/17", description: "Done." });
  const before = await read(c.id);
  const r = await deliver(prEvent({ number: 17 }));
  assert.deepEqual(r.body.moved, []);
  assert.deepEqual(await read(c.id), before);
});

test("a board with no Done column: the card stays and the line says so", { skip }, async () => {
  const c = await card(ours.ops.cols.todo, { pr: "https://github.com/acme/web/pull/18" });
  const r = await deliver(prEvent({ number: 18 }));
  assert.deepEqual(r.body.moved, []);
  assert.deepEqual(r.body.noted, [c.id]);
  const after = await read(c.id);
  assert.equal(after.slug, "todo");
  assert.match(after.description, /PR acme\/web#18 merged, but this board has no Done column/);
});

test("a redelivery does nothing the second time", { skip }, async () => {
  const c = await card(ours.dev.cols.todo, { pr: "https://github.com/acme/web/pull/19" });
  const first = await deliver(prEvent({ number: 19, merged: false }), { id: "redeliver-19" });
  assert.deepEqual(first.body.noted, [c.id]);
  const once = (await read(c.id)).description;
  const again = await deliver(prEvent({ number: 19, merged: false }), { id: "redeliver-19" });
  assert.equal(again.status, 200);
  assert.equal(again.body.outcome, "duplicate");
  assert.equal((await read(c.id)).description, once);
});

test("events other than a closed PR are ignored and not recorded", { skip }, async () => {
  const c = await card(ours.dev.cols.todo, { pr: "https://github.com/acme/web/pull/20" });
  const opened = await deliver(prEvent({ number: 20, action: "opened" }), { id: "opened-20" });
  assert.equal(opened.status, 204);
  const push = await deliver({ installation: { id: INSTALL } }, { event: "push", id: "push-1" });
  assert.equal(push.status, 204);
  assert.equal((await read(c.id)).slug, "todo");
  const { rows } = await db.query("SELECT 1 FROM github_deliveries WHERE delivery_id = ANY($1)", [["opened-20", "push-1"]]);
  assert.equal(rows.length, 0);
});

test("a malformed closed-PR payload is a 400 and changes nothing", { skip }, async () => {
  const r = await deliver({ action: "closed", installation: { id: INSTALL }, pull_request: { number: "x" } }, { id: "bad-1" });
  assert.equal(r.status, 400);
  const { rows } = await db.query("SELECT 1 FROM github_deliveries WHERE delivery_id = 'bad-1'");
  assert.equal(rows.length, 0, "not recorded, so a fixed redelivery still runs");
});

test("uninstalling the App removes its binding", { skip }, async () => {
  const c = await card(theirs.dev.cols.todo, { pr: "https://github.com/rival/app/pull/1" });
  const r = await deliver({ action: "deleted", installation: { id: OTHER_INSTALL } }, { event: "installation" });
  assert.equal(r.status, 200);
  const { rows } = await db.query("SELECT 1 FROM github_installations WHERE installation_id = $1", [OTHER_INSTALL]);
  assert.equal(rows.length, 0);
  const merged = await deliver(prEvent({ number: 1, repo: "rival/app", installation: OTHER_INSTALL }));
  assert.equal(merged.body.outcome, "unbound");
  assert.equal((await read(c.id)).slug, "todo");
});

test("an installation bound to one team can't be bound to another", { skip }, async () => {
  await assert.rejects(
    gh.bindInstallation({ installationId: INSTALL, teamId: theirs.team, accountLogin: "acme" }),
    /already connected to another team/
  );
  // Binding again to the same team is fine (a reinstall).
  await gh.bindInstallation({ installationId: INSTALL, teamId: ours.team, accountLogin: "acme-renamed" });
  const { rows } = await db.query("SELECT team_id, account_login FROM github_installations WHERE installation_id = $1", [INSTALL]);
  assert.deepEqual(rows, [{ team_id: ours.team, account_login: "acme-renamed" }]);
});
