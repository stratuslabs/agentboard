#!/usr/bin/env node
//
// Live board updates: the delta endpoint and the event stream.
//
// Creates its own organization and product, exercises `/api/board` and
// `/api/stream` against them, then removes them again. Nothing else in the
// database is touched.
//
//   BASE_URL=http://localhost:3000 POSTGRES_URL=... node scripts/verify-realtime.mjs

import pg from "pg";
import { sql, end, connectionString, sslConfig } from "../src/lib/sql.js";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const TOKEN = process.env.APP_PASSWORD || "";

// A delta reaches this far back beyond its cursor, so that a write stamped
// before the cursor but committed after it is not lost. Assertions about a
// delta carrying *exactly* what changed have to let the window pass first, or
// they are really asserting how fast the test runs.
const OVERLAP_MS = Number(process.env.BOARD_DELTA_OVERLAP_MS ?? 2_000) || 0;
const settle = () => new Promise((r) => setTimeout(r, OVERLAP_MS + 250));

let passed = 0;
let failed = 0;

function check(name, condition, detail = "") {
  if (condition) {
    passed++;
    console.log(`  ok   ${name}`);
  } else {
    failed++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
}

async function call(method, path, body, extraHeaders) {
  const headers = { "Content-Type": "application/json", ...extraHeaders };
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // A non-JSON body is a result in itself; the caller asserts on status.
  }
  return { status: res.status, headers: res.headers, body: json };
}

/**
 * Read Server-Sent Events until `want` of them arrive or the deadline passes.
 * Returns the parsed events and whether the server closed the stream itself.
 */
async function readStream(path, { want = 1, timeoutMs = 10_000, onOpen } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const headers = { Accept: "text/event-stream" };
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;

  const events = [];
  let closedByServer = false;
  try {
    const res = await fetch(`${BASE}${path}`, { headers, signal: controller.signal });
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let fired = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        closedByServer = true;
        break;
      }
      buffer += decoder.decode(value, { stream: true });

      let split;
      while ((split = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, split);
        buffer = buffer.slice(split + 2);
        const name = /^event: (.+)$/m.exec(frame)?.[1];
        const data = /^data: (.+)$/m.exec(frame)?.[1];
        if (name && data) events.push({ name, data: JSON.parse(data) });
      }

      // The writer runs only once the stream is known to be open, so the event
      // it triggers cannot be missed by racing the connection.
      if (!fired && events.some((e) => e.name === "hello")) {
        fired = true;
        if (onOpen) await onOpen();
      }
      if (events.filter((e) => e.name === "change").length >= want) break;
    }
  } catch (err) {
    if (err.name !== "AbortError") throw err;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
  return { events, closedByServer };
}

async function main() {
  console.log(`Verifying live updates against ${BASE}`);

  // ---- fixture -----------------------------------------------------------
  const orgName = `Realtime Check ${Date.now()}`;
  const org = await call("POST", "/api/orgs", { name: orgName });
  if (org.status !== 201) {
    console.error(`Could not create an organization (${org.status}). Is the server running?`);
    process.exit(1);
  }
  const orgId = org.body.id;
  const product = await call("POST", "/api/products", { org_id: orgId, name: "Realtime Product" });
  const productId = product.body.id;

  try {
    // ---- the composite response ------------------------------------------
    section("One request for the whole board");
    const full = await call("GET", `/api/board?product_id=${productId}`);
    check("returns 200", full.status === 200, `got ${full.status}`);
    check("carries boards, columns and cards together",
      Array.isArray(full.body.boards) && Array.isArray(full.body.columns) && Array.isArray(full.body.cards));
    check("seeds the default boards", full.body.boards.length === 4, `got ${full.body.boards.length}`);
    check("seeds the default columns", full.body.columns.length === 5, `got ${full.body.columns.length}`);
    check("names an active board", typeof full.body.active_board_id === "number");
    check("hands back a cursor", typeof full.body.server_time === "string");
    check("omits card_ids when not a delta", full.body.card_ids === undefined);

    const boardId = full.body.active_board_id;
    const columnId = full.body.columns[0].id;
    const etag = full.headers.get("etag");
    check("sets a validator", Boolean(etag), "no ETag header");

    section("Requests that need no answer");
    const unchanged = await call("GET", `/api/board?product_id=${productId}`, undefined, { "If-None-Match": etag });
    check("an unchanged board is a 304", unchanged.status === 304, `got ${unchanged.status}`);

    section("Deltas carry only what moved");
    const cursor = full.body.server_time;
    const quiet = await call("GET", `/api/board?product_id=${productId}&updated_since=${encodeURIComponent(cursor)}`);
    check("a delta with no writes is empty", quiet.body.cards.length === 0, `got ${quiet.body.cards.length}`);
    check("a delta always lists every card id", Array.isArray(quiet.body.card_ids));

    const first = await call("POST", "/api/cards", { column_id: columnId, title: "Delta one" });
    const second = await call("POST", "/api/cards", { column_id: columnId, title: "Delta two" });
    const afterCreate = await call("GET", `/api/board?product_id=${productId}&updated_since=${encodeURIComponent(cursor)}`);
    check("a delta returns exactly the new cards", afterCreate.body.cards.length === 2, `got ${afterCreate.body.cards.length}`);
    check("card_ids covers the whole board", afterCreate.body.card_ids.length === 2);
    check("the validator moves after a write", afterCreate.headers.get("etag") !== etag);

    const stale = await call("GET", `/api/board?product_id=${productId}`, undefined, { "If-None-Match": etag });
    check("a stale validator is answered in full", stale.status === 200, `got ${stale.status}`);

    // Past the overlap, so the two creations above are behind the window and
    // the delta below can be held to exactly what this edit changed.
    await settle();
    const cursor2 = (await call("GET", `/api/board?product_id=${productId}`)).body.server_time;
    await call("PATCH", `/api/cards/${first.body.id}`, { title: "Delta one, edited" });
    const afterEdit = await call("GET", `/api/board?product_id=${productId}&updated_since=${encodeURIComponent(cursor2)}`);
    check("an edit returns one card", afterEdit.body.cards.length === 1, `got ${afterEdit.body.cards.length}`);
    check("and it is the edited one", afterEdit.body.cards[0]?.title === "Delta one, edited");

    section("Deletions, which a delta cannot report on its own");
    await settle();
    const cursor3 = (await call("GET", `/api/board?product_id=${productId}`)).body.server_time;
    await call("DELETE", `/api/cards/${second.body.id}`);
    const afterDelete = await call("GET", `/api/board?product_id=${productId}&updated_since=${encodeURIComponent(cursor3)}`);
    check("a delete produces no changed row", afterDelete.body.cards.length === 0, `got ${afterDelete.body.cards.length}`);
    check("but card_ids reveals it by set difference",
      !afterDelete.body.card_ids.includes(second.body.id), `card_ids still lists ${second.body.id}`);

    section("Precision");
    const beforeRapid = await call("GET", `/api/board?product_id=${productId}`);
    await call("PATCH", `/api/cards/${first.body.id}`, { title: "rapid A" });
    await call("PATCH", `/api/cards/${first.body.id}`, { title: "rapid B" });
    const afterRapid = await call("GET", `/api/board?product_id=${productId}`);
    check("two edits inside one second still move the validator",
      beforeRapid.headers.get("etag") !== afterRapid.headers.get("etag"),
      "a second-granular stamp would collapse these and serve a stale 304");

    section("Arguments");
    const missing = await call("GET", "/api/board");
    check("product_id is required", missing.status === 400, `got ${missing.status}`);
    const bogus = await call("GET", `/api/board?product_id=${productId}&board_id=99999999`);
    check("an unknown board falls back rather than erroring",
      bogus.status === 200 && bogus.body.active_board_id === boardId);

    section("Changes that touch a card without writing to it");
    // Cards carry a member's name, type and colour through a join. Editing the
    // member changes what they render, and nothing writes to the card row — so
    // without an explicit stamp they never appear in a delta. The three-second
    // poll used to hide this.
    const member = await call("POST", "/api/members", {
      name: `Verify Member ${Date.now()}`,
      type: "human",
      color: "#3B82F6",
    });
    const assigned = await call("POST", "/api/cards", {
      column_id: columnId,
      title: "Assigned card",
      assignee_id: member.body.id,
    });

    const beforeRename = (await call("GET", `/api/board?product_id=${productId}`)).body.server_time;
    await call("PATCH", `/api/members/${member.body.id}`, { name: "Renamed Member" });
    const afterRename = await call(
      "GET",
      `/api/board?product_id=${productId}&updated_since=${encodeURIComponent(beforeRename)}`,
    );
    const renamed = afterRename.body.cards.find((c) => c.id === assigned.body.id);
    check("renaming a member puts its cards in the next delta", Boolean(renamed),
      "otherwise the old name sits on the card until a full reload");
    check("and the card carries the new name", renamed?.assignee_name === "Renamed Member",
      renamed ? `got ${renamed.assignee_name}` : "");

    const beforeMemberDelete = afterRename.body.server_time;
    await call("DELETE", `/api/members/${member.body.id}`);
    const afterMemberDelete = await call(
      "GET",
      `/api/board?product_id=${productId}&updated_since=${encodeURIComponent(beforeMemberDelete)}`,
    );
    const unassigned = afterMemberDelete.body.cards.find((c) => c.id === assigned.body.id);
    check("deleting a member puts its cards in the next delta", Boolean(unassigned),
      "ON DELETE SET NULL unassigns them, which is a visible change");
    check("and they come back unassigned", unassigned?.assignee_id === null,
      unassigned ? `assignee_id=${unassigned.assignee_id}` : "");

    section("Deletes that cascade past the instrumented routes");
    // Deleting a product cascades through boards, columns and cards without any
    // of those routes running, so nothing else announces it and another tab
    // keeps rendering rows that are gone.
    const doomed = await call("POST", "/api/products", {
      org_id: orgId,
      name: `Doomed ${Date.now()}`,
    });
    const doomedBoard = await call("GET", `/api/board?product_id=${doomed.body.id}`);
    const cascade = await readStream(`/api/stream?board_id=${doomedBoard.body.active_board_id}`, {
      want: 1,
      timeoutMs: 8_000,
      onOpen: () => call("DELETE", `/api/products/${doomed.body.id}`),
    });
    check("deleting a product notifies the boards under it",
      cascade.events.some((e) => e.name === "change"),
      "a tab on one of those boards would otherwise never hear");

    // A write is stamped with NOW(), which is transaction-start time, and only
    // becomes visible at commit. Held open deliberately, that gap is wide
    // enough to drive from the outside: the row carries a timestamp from
    // before the cursor was sampled, and appears after the cards were read.
    section("A write that commits after the cursor was sampled");
    if (OVERLAP_MS === 0) {
      console.log("  skip (BOARD_DELTA_OVERLAP_MS=0 disables the window this exercises)");
    } else {
    const dsn = connectionString();
    const holder = new pg.Client({ connectionString: dsn, ssl: sslConfig(dsn) });
    await holder.connect();
    try {
      await holder.query("BEGIN");
      await holder.query(
        "UPDATE cards SET title = $2, updated_at = NOW() WHERE id = $1",
        [first.body.id, "Committed late"]
      );

      // Sampled while the write is stamped but not yet visible.
      const sampled = await call("GET", `/api/board?product_id=${productId}`);
      const raceCursor = sampled.body.server_time;
      check("the uncommitted write is not in the response",
        !sampled.body.cards.some((c) => c.title === "Committed late"));

      // Two reads while the write is still open must agree with each other:
      // the validator and the rows it describes come from one snapshot.
      const again = await call("GET", `/api/board?product_id=${productId}`);
      check("two reads during an open write agree",
        sampled.headers.get("etag") === again.headers.get("etag"),
        `${sampled.headers.get("etag")} vs ${again.headers.get("etag")}`);

      await holder.query("COMMIT");

      const afterCommit = await call(
        "GET",
        `/api/board?product_id=${productId}&updated_since=${encodeURIComponent(raceCursor)}`
      );
      const late = afterCommit.body.cards.find((c) => c.id === first.body.id);
      check("a write stamped before the cursor still reaches the next delta",
        Boolean(late),
        `delta carried ${afterCommit.body.cards.length} card(s)`);
      check("and carries the committed value",
        late?.title === "Committed late",
        `got ${late?.title ?? "nothing"}`);
    } finally {
      await holder.query("ROLLBACK").catch(() => {});
      await holder.end().catch(() => {});
    }
    }

    section("The event stream");
    const opened = await readStream(`/api/stream?board_id=${boardId}`, {
      want: 1,
      onOpen: () => call("POST", "/api/cards", { column_id: columnId, title: "Stream probe" }),
    });
    const hello = opened.events.find((e) => e.name === "hello");
    check("the stream announces itself", Boolean(hello));
    check("and reports how it is sourcing changes",
      hello && (hello.data.mode === "listen" || hello.data.mode === "poll"),
      hello ? `mode=${hello.data.mode}` : "");
    // `listen` is now only reported after a notification has actually made the
    // round trip. A pooled connection that accepts LISTEN and delivers nothing
    // reports `poll` instead of going silently dead.
    check("a reported listen mode has been proved, not assumed",
      hello?.data.mode !== "listen" || process.env.EXPECT_POLL !== "1",
      "set EXPECT_POLL=1 when the listener URL is pooled");
    const change = opened.events.find((e) => e.name === "change");
    check("a write produces a change event", Boolean(change));
    check("the event names the board", change && change.data.board_id === boardId,
      change ? `got ${change.data.board_id}` : "");

    section("Scoping");
    const otherBoard = full.body.boards.find((b) => b.id !== boardId).id;
    const otherCols = await call("GET", `/api/columns?board_id=${otherBoard}`);
    const quietStream = await readStream(`/api/stream?board_id=${boardId}`, {
      want: 1,
      timeoutMs: 4_000,
      onOpen: () => call("POST", "/api/cards", { column_id: otherCols.body[0].id, title: "Elsewhere" }),
    });
    check("a write to another board does not wake this stream",
      quietStream.events.filter((e) => e.name === "change").length === 0,
      "a board-scoped stream should hear only its own board");

    section("Reconnection");
    // The stream closes on its own schedule so a platform timeout never cuts a
    // response mid-write; the client is told before it happens.
    const capped = await readStream(`/api/stream?board_id=${boardId}`, { want: 99, timeoutMs: 20_000 });
    const reconnect = capped.events.find((e) => e.name === "reconnect");
    if (Number(process.env.SSE_MAX_SECONDS || 240) <= 15) {
      check("the server closes the stream itself", capped.closedByServer);
      check("and sends a reconnect event first", Boolean(reconnect));
    } else {
      console.log("  skip the self-terminate check (set SSE_MAX_SECONDS=3 to exercise it)");
    }
  } finally {
    // The organization cascades to products, boards, columns and cards.
    await sql`DELETE FROM organizations WHERE id = ${orgId}`;
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  await end();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error(err);
  await end().catch(() => {});
  process.exit(1);
});
