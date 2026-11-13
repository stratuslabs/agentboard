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
const { fetchBoardMembers } = await import("../src/components/settings/BoardMembers.tsx");
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
