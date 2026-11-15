// A desktop where someone collapsed the sidebar used to load the full 256px
// sidebar and then jump to the 52px rail. The collapse lives in localStorage,
// which the server can't read, so the server sent the full sidebar, the first
// client render read the collapse and drew the rail, and React threw the
// mismatched HTML away and re-rendered the page (AB-157).
//
// Now the server's HTML, and so the hydration render, is the same whatever the
// browser saved: both forms, with the rail hidden. A small inline script runs
// before the sidebar is parsed and, if a collapse is saved, adds a style that
// shows the rail and hides the full sidebar on a desktop. React then keeps the
// form that is showing. The script only adds a <style> to <head>, which React
// leaves alone, so nothing React rendered changes before it hydrates.
//
//   node --test test/

import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import vm from "node:vm";

register("./support/ts-loader.mjs", import.meta.url);

const { createElement: h } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime.js");
const { PathnameContext } = await import("next/dist/shared/lib/hooks-client-context.shared-runtime.js");
const { PreferencesProvider } = await import("../src/contexts/PreferencesContext.tsx");
const { default: BoardLayout } = await import("../src/components/BoardLayout.tsx");
const { attr } = await import("./support/nested-interactive.mjs");
const { PHONE_QUERY } = await import("../src/contexts/SidebarContext.tsx");

const router = { push() {}, replace() {}, prefetch() {}, back() {}, forward() {}, refresh() {} };

function render(pathname, props = {}) {
  return renderToStaticMarkup(
    h(AppRouterContext.Provider, { value: router },
      h(PathnameContext.Provider, { value: pathname },
        h(PreferencesProvider, null,
          h(BoardLayout, props, h("main", { "data-testid": "page" }, "Page"))))),
  );
}

/** Render in a browser-like global: a saved collapse (or not) at a phone or desktop width. */
function renderInBrowser(pathname, { collapsed, phone }) {
  const saved = { window: globalThis.window, localStorage: globalThis.localStorage, matchMedia: globalThis.matchMedia };
  globalThis.window = globalThis;
  globalThis.localStorage = { getItem: (k) => (k === "agentboard-sidebar-collapsed" ? String(collapsed) : null), setItem() {} };
  globalThis.matchMedia = (q) => ({ matches: q === PHONE_QUERY && phone, addEventListener() {}, removeEventListener() {} });
  try {
    return render(pathname);
  } finally {
    for (const [k, v] of Object.entries(saved)) if (v === undefined) delete globalThis[k]; else globalThis[k] = v;
  }
}

const classes = (tag) => (attr(tag, "class") ?? "").split(/\s+/).filter(Boolean);
const formTag = (html, form) => html.match(new RegExp(`<div[^>]*\\sdata-sidebar-form="${form}"[^>]*>`))?.[0];

/** The inline scripts in the HTML, in order, with where each starts. */
const scripts = (html) => [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => ({ code: m[1], index: m.index }));

/** Run the preload script against a fake document; return the <style> elements it added to <head>. */
function runPreload(code, storage) {
  const added = [];
  const document = {
    head: { appendChild: (el) => { added.push(el); return el; } },
    createElement: (tag) => ({ tagName: tag.toUpperCase(), attributes: {}, textContent: "", setAttribute(k, v) { this.attributes[k] = v; } }),
  };
  vm.runInNewContext(code, { document, localStorage: storage });
  return added;
}

const savedCollapse = (value) => ({ getItem: (k) => (k === "agentboard-sidebar-collapsed" ? value : null) });

for (const path of ["/", "/stratus-labs/agentboard"]) {
  test(`${path}: the server's HTML is the same whatever the browser saved, so hydration matches`, () => {
    const server = render(path);
    for (const collapsed of [true, false]) for (const phone of [true, false]) {
      assert.equal(renderInBrowser(path, { collapsed, phone }), server, `first render with collapsed=${collapsed} phone=${phone}`);
    }
  });

  test(`${path}: the server sends both forms, the rail hidden until the preload style shows it`, () => {
    const html = render(path);
    const rail = formTag(html, "rail");
    const full = formTag(html, "full");
    assert.ok(rail, "the server's HTML has the 52px rail");
    assert.ok(full, "the server's HTML has the full sidebar");
    assert.ok(classes(rail).includes("w-[52px]"), `rail is 52px: ${rail}`);
    assert.ok(classes(rail).includes("hidden"), `rail is hidden without a saved collapse: ${rail}`);
    assert.ok(classes(full).includes("w-64"), `full sidebar is 256px: ${full}`);
    assert.ok(!classes(full).includes("hidden"), `full sidebar shows without a saved collapse: ${full}`);
  });

  test(`${path}: the preload script runs before the sidebar is parsed`, () => {
    const html = render(path);
    const [preload] = scripts(html);
    assert.ok(preload, "the frame has an inline preload script");
    assert.ok(preload.index < html.indexOf('data-sidebar-form="rail"'), "script comes before the rail");
    assert.ok(preload.index < html.indexOf('data-sidebar-form="full"'), "script comes before the full sidebar");
  });
}

test("a saved collapse: the preload style shows the rail and hides the full sidebar, on a desktop only", () => {
  const [{ code }] = scripts(render("/"));
  const added = runPreload(code, savedCollapse("true"));
  assert.equal(added.length, 1, "one style added");
  assert.equal(added[0].tagName, "STYLE");
  const css = added[0].textContent.replace(/\s+/g, " ");
  // Desktop only: the same breakpoint as PHONE_QUERY, so a phone keeps the full sidebar.
  const media = css.match(/@media \(min-width: ?768px\) ?\{(.*)\}\s*$/);
  assert.ok(media, `rules sit in a min-width: 768px query: ${css}`);
  // :root raises each rule above one utility class, such as the rail's "hidden".
  assert.match(media[1], /:root \[data-sidebar-form="?rail"?\] ?\{ ?display: ?flex;? ?\}/, `rail shows: ${css}`);
  assert.match(media[1], /:root \[data-sidebar-form="?full"?\] ?\{ ?display: ?none;? ?\}/, `full sidebar hides: ${css}`);
});

test("no saved collapse, or storage that throws: the preload script adds nothing and doesn't throw", () => {
  const [{ code }] = scripts(render("/"));
  assert.equal(runPreload(code, savedCollapse(null)).length, 0);
  assert.equal(runPreload(code, savedCollapse("false")).length, 0);
  assert.equal(runPreload(code, { getItem() { throw new Error("SecurityError"); } }).length, 0);
});

test("sidebar slots wait for the browser, so one control doesn't mount in both forms", () => {
  // Cloud passes its team switcher for both forms, and each one fetches the
  // account when it mounts. Rendering both forms with slots would fetch twice.
  const html = render("/", {
    sidebarFooter: h("span", { "data-testid": "footer-slot" }),
    sidebarRail: h("span", { "data-testid": "rail-slot" }),
  });
  assert.ok(!html.includes("footer-slot"), "footer slot is not in the server's HTML");
  assert.ok(!html.includes("rail-slot"), "rail slot is not in the server's HTML");
});
