// When the members list can't load (offline, a dropped connection, a server
// error), Settings says so and offers Try again instead of a loading line that
// never ends (AB-140). fetchBoardMembers never throws, so the hook always
// finishes loading, and MemberListError is what shows in the list's place.
//
//   node --test test/

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./support/ts-loader.mjs", import.meta.url);

const { createElement: h } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { fetchBoardMembers, membersLoader } = await import("../src/components/settings/BoardMembers.tsx");
const { MemberListError } = await import("../src/components/settings/MemberList.tsx");

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const dana = { id: 1, name: "Dana", type: "human", color: "#ef4444" };

test("fetchBoardMembers returns the members the server sends", async () => {
  globalThis.fetch = async (url) => {
    assert.equal(url, "/api/members");
    return new Response(JSON.stringify([dana]), { status: 200, headers: { "content-type": "application/json" } });
  };
  assert.deepEqual(await fetchBoardMembers(), [dana]);
});

test("fetchBoardMembers resolves to null when the request never reaches the server", async () => {
  globalThis.fetch = async () => {
    throw new TypeError("Failed to fetch");
  };
  assert.equal(await fetchBoardMembers(), null);
});

test("fetchBoardMembers resolves to null on a server error, not an empty list", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ error: "boom" }), { status: 500 });
  assert.equal(await fetchBoardMembers(), null);
});

test("fetchBoardMembers resolves to null when the answer isn't JSON (a proxy's error page)", async () => {
  globalThis.fetch = async () => new Response("<html>Bad gateway</html>", { status: 200 });
  assert.equal(await fetchBoardMembers(), null);
});

/** A fetch stand-in whose answer the test hands over later. */
function deferred() {
  let resolve;
  const promise = new Promise((ok) => (resolve = ok));
  return { promise, resolve };
}

test("an older load that fails after a newer one worked doesn't replace the list with an error", async () => {
  const first = deferred();
  const second = deferred();
  const answers = [first.promise, second.promise];
  const applied = [];
  const load = membersLoader((members) => applied.push(members), () => answers.shift());
  const a = load(); // the page's first load, still on its way
  const b = load(); // a reload after adding a member
  second.resolve([dana]);
  await b;
  first.resolve(null);
  await a;
  assert.deepEqual(applied, [[dana]]);
});

test("an older load that answers late doesn't overwrite a newer list", async () => {
  const first = deferred();
  const second = deferred();
  const answers = [first.promise, second.promise];
  const applied = [];
  const load = membersLoader((members) => applied.push(members), () => answers.shift());
  const a = load();
  const b = load();
  second.resolve([dana, { id: 2, name: "Atlas", type: "agent", color: "#22c55e" }]);
  await b;
  first.resolve([dana]);
  await a;
  assert.equal(applied.length, 1);
  assert.equal(applied[0].length, 2);
});

test("loads that don't overlap each apply their answer", async () => {
  const answers = [Promise.resolve([dana]), Promise.resolve(null)];
  const applied = [];
  const load = membersLoader((members) => applied.push(members), () => answers.shift());
  await load();
  await load();
  assert.deepEqual(applied, [[dana], null]);
});

test("MemberListError names the problem and the way out, and is announced", () => {
  const html = renderToStaticMarkup(h(MemberListError, { title: "Couldn't load members", onRetry: async () => {} }));
  assert.match(html, /role="alert"/);
  assert.match(html, /Couldn(&#x27;|')t load members/);
  assert.match(html, /Check your connection and try again\./);
  const button = html.match(/<button\b[^>]*>(.*?)<\/button>/);
  assert.ok(button, `no button in ${html}`);
  assert.match(button[0], /type="button"/);
  assert.equal(button[1].replace(/<[^>]+>/g, "").trim(), "Try again");
});
