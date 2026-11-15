// On a desktop, "/" goes on to the product you last opened. On a phone, "/" is
// the sidebar screen and must never redirect. Reaching "/" by a client-side
// navigation from outside the board screens (Settings' "Back to boards") sent
// a phone to the last product anyway (AB-160): the board frame mounts fresh
// there, the home page's effect runs before the frame's own effect has set
// isMobile, so it took the desktop path, and the lookup it started still
// redirected after isMobile turned true.
//
// The home page now checks the phone query itself when it starts, and the
// restore it starts can be cancelled, so a lookup whose inputs changed while
// it was in flight does nothing when it answers.
//
//   node --test test/

import { test } from "node:test";
import assert from "node:assert/strict";
import { restoreLastProduct } from "../src/lib/home-restore.js";

const orgs = [{ id: 1, slug: "stratus-labs" }, { id: 2, slug: "other" }];
const products = [{ id: 7, slug: "agentboard" }, { id: 8, slug: "super" }];
const selected = { productId: 7, orgId: 1 };

/** A fetchJson that answers when release() is called, and records its URLs. */
function heldLookups(answers = { "/api/orgs": orgs, "/api/products?org_id=1": products }) {
  const urls = [];
  const waiting = [];
  const fetchJson = (url) => {
    urls.push(url);
    return new Promise((resolve, reject) => waiting.push(() => (url in answers ? resolve(answers[url]) : reject(new Error(`no answer for ${url}`)))));
  };
  const release = async () => {
    for (const answer of waiting.splice(0)) answer();
    // Let Promise.all and the .then/.catch after it run.
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };
  return { fetchJson, urls, release };
}

function outcome() {
  const seen = { went: [], stayed: 0 };
  return { seen, go: (path) => seen.went.push(path), stay: () => { seen.stayed++; } };
}

test("a desktop goes on to the last product", async () => {
  const { fetchJson, urls, release } = heldLookups();
  const { seen, go, stay } = outcome();
  restoreLastProduct({ onPhone: false, selected, fetchJson, go, stay });
  assert.deepEqual(urls, ["/api/orgs", "/api/products?org_id=1"]);
  await release();
  assert.deepEqual(seen, { went: ["/stratus-labs/agentboard"], stayed: 0 });
});

test("a phone stays on \"/\" and doesn't look anything up", async () => {
  const { fetchJson, urls, release } = heldLookups();
  const { seen, go, stay } = outcome();
  restoreLastProduct({ onPhone: true, selected, fetchJson, go, stay });
  await release();
  assert.deepEqual(urls, []);
  assert.deepEqual(seen, { went: [], stayed: 1 });
});

test("cancelled while the lookups are in flight, it never redirects", async () => {
  // The phone case from AB-160: started as a desktop, then isMobile turned
  // true and the effect's cleanup ran before the lookups answered.
  const { fetchJson, release } = heldLookups();
  const { seen, go, stay } = outcome();
  const cancel = restoreLastProduct({ onPhone: false, selected, fetchJson, go, stay });
  cancel();
  await release();
  assert.deepEqual(seen, { went: [], stayed: 0 });
});

test("cancelled while a failing lookup is in flight, it does nothing", async () => {
  const { fetchJson, release } = heldLookups({});
  const { seen, go, stay } = outcome();
  const cancel = restoreLastProduct({ onPhone: false, selected, fetchJson, go, stay });
  cancel();
  await release();
  assert.deepEqual(seen, { went: [], stayed: 0 });
});

test("nothing opened before: stays without looking anything up", async () => {
  const { fetchJson, urls } = heldLookups();
  const { seen, go, stay } = outcome();
  restoreLastProduct({ onPhone: false, selected: null, fetchJson, go, stay });
  assert.deepEqual(urls, []);
  assert.deepEqual(seen, { went: [], stayed: 1 });
});

test("the last product or its team is gone: stays", async () => {
  for (const answers of [
    { "/api/orgs": orgs, "/api/products?org_id=1": [{ id: 8, slug: "super" }] },
    { "/api/orgs": [{ id: 2, slug: "other" }], "/api/products?org_id=1": products },
  ]) {
    const { fetchJson, release } = heldLookups(answers);
    const { seen, go, stay } = outcome();
    restoreLastProduct({ onPhone: false, selected, fetchJson, go, stay });
    await release();
    assert.deepEqual(seen, { went: [], stayed: 1 });
  }
});

test("a lookup that fails or isn't a list: stays", async () => {
  for (const answers of [
    { "/api/orgs": orgs },
    { "/api/orgs": { error: "Unauthorized" }, "/api/products?org_id=1": products },
  ]) {
    const { fetchJson, release } = heldLookups(answers);
    const { seen, go, stay } = outcome();
    restoreLastProduct({ onPhone: false, selected, fetchJson, go, stay });
    await release();
    assert.deepEqual(seen, { went: [], stayed: 1 });
  }
});

test("the cancel function is safe to call more than once, and after it settled", async () => {
  const { fetchJson, release } = heldLookups();
  const { seen, go, stay } = outcome();
  const cancel = restoreLastProduct({ onPhone: false, selected, fetchJson, go, stay });
  await release();
  cancel();
  cancel();
  assert.deepEqual(seen, { went: ["/stratus-labs/agentboard"], stayed: 0 });
  const early = restoreLastProduct({ onPhone: true, selected, fetchJson, go, stay });
  early();
  early();
});
