// Settings > Default boards / Default columns: when the team's settings can't
// be loaded (offline, a server error, an answer that isn't the settings), the
// section says so and offers Try again. It must not show the built-in lists
// as if they were the team's, because Save would then overwrite the real ones
// (AB-146). A list that was never saved still shows the built-in one.
//
//   node --test test/

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { register } from "node:module";

register("./support/ts-loader.mjs", import.meta.url);

const { loadSettings } = await import("../src/lib/settings-load.js");
const { listSetting } = await import("../src/components/settings/DefaultLists.tsx");
const { createElement: h } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { ListLoadError } = await import("../src/components/settings/ListLoadError.tsx");
const { MemberListError } = await import("../src/components/settings/MemberList.tsx");

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const FALLBACK = ["Development", "Marketing", "Sales", "Support"];

test("loadSettings returns the team's settings from GET /api/settings", async () => {
  const calls = [];
  const settings = { default_boards: ["Engineering", "Ops"] };
  const result = await loadSettings(async (url, init) => {
    calls.push({ url, init });
    return json(200, settings);
  });
  assert.deepEqual(result, { ok: true, settings });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/settings");
  assert.ok(!calls[0].init || !calls[0].init.method || calls[0].init.method === "GET");
});

test("loadSettings uses the global fetch by default", async () => {
  globalThis.fetch = async () => json(200, {});
  assert.deepEqual(await loadSettings(), { ok: true, settings: {} });
});

test("a dropped connection is a failed load, not a thrown error", async () => {
  const result = await loadSettings(async () => {
    throw new TypeError("Failed to fetch");
  });
  assert.deepEqual(result, { ok: false });
});

test("a server error with a JSON error body is a failed load, not empty settings", async () => {
  for (const status of [401, 403, 500, 503]) {
    const result = await loadSettings(async () => json(status, { error: "database is unavailable" }));
    assert.deepEqual(result, { ok: false }, `status ${status}`);
  }
});

test("an answer that isn't JSON (a proxy's error page) is a failed load", async () => {
  const result = await loadSettings(async () => new Response("<html>Bad gateway</html>", { status: 200 }));
  assert.deepEqual(result, { ok: false });
});

test("JSON that isn't a settings object is a failed load", async () => {
  for (const body of [null, [], ["Development"], "settings", 42]) {
    const result = await loadSettings(async () => json(200, body));
    assert.deepEqual(result, { ok: false }, JSON.stringify(body));
  }
});

test("a failed load gives the section nothing to show or save", () => {
  assert.deepEqual(listSetting({ ok: false }, "default_boards", FALLBACK), { status: "failed" });
});

test("a saved list is shown as saved, even an empty one", () => {
  assert.deepEqual(listSetting({ ok: true, settings: { default_boards: ["Engineering"] } }, "default_boards", FALLBACK), {
    status: "ready",
    value: ["Engineering"],
  });
  assert.deepEqual(listSetting({ ok: true, settings: { default_boards: [] } }, "default_boards", FALLBACK), {
    status: "ready",
    value: [],
  });
});

test("a list that was never saved shows the built-in one, like the server uses", () => {
  assert.deepEqual(listSetting({ ok: true, settings: {} }, "default_boards", FALLBACK), { status: "ready", value: FALLBACK });
  assert.deepEqual(listSetting({ ok: true, settings: { default_columns: [] } }, "default_boards", FALLBACK), {
    status: "ready",
    value: FALLBACK,
  });
});

test("ListLoadError names the problem and the way out, and is announced", () => {
  const html = renderToStaticMarkup(h(ListLoadError, { title: "Couldn't load default boards", onRetry: async () => {} }));
  assert.match(html, /role="alert"/);
  assert.match(html, /Couldn(&#x27;|')t load default boards/);
  const button = html.match(/<button\b[^>]*>(.*?)<\/button>/);
  assert.ok(button, `no button in ${html}`);
  assert.match(button[0], /type="button"/);
  assert.equal(button[1].replace(/<[^>]+>/g, "").trim(), "Try again");
});

test("MemberListError is still exported for Cloud's Members section", () => {
  assert.equal(MemberListError, ListLoadError);
});

test("DefaultLists loads through loadSettings and has no bare settings fetch that falls back to defaults", () => {
  const src = readFileSync(`${ROOT}src/components/settings/DefaultLists.tsx`, "utf8");
  assert.match(src, /loadSettings\(/, "the sections should load through loadSettings");
  assert.doesNotMatch(src, /fetch\(\s*["'`]\/api\/settings/, "no unchecked GET /api/settings left in the component");
  assert.doesNotMatch(src, /\.catch\(\s*\(\)\s*=>\s*set\w*\(\s*fallback/, "a failed load must not fall back to the defaults");
  assert.match(src, /<ListLoadError\b/, "a failed load shows ListLoadError");
});
