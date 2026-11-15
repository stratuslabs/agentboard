// The board screens' frame shows the sidebar beside the page, or one of the two
// on a phone: the sidebar alone on "/", the page alone everywhere else. Which
// one is a JS decision (isMobile), and it is false until the browser has run
// the app's code, so the server's HTML used to be the desktop frame at every
// width. A phone painted a 256px sidebar beside the page, then dropped it when
// JS loaded, and the page jumped: Lighthouse measured a layout shift of 0.31 on
// the board page (AB-155). The frame's HTML now carries the phone layout in CSS
// too, so the first paint already matches what JS settles on.
//
//   node --test test/

import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

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

/** The frame's server HTML for a path, with a stand-in page. */
function render(pathname) {
  return renderToStaticMarkup(
    h(AppRouterContext.Provider, { value: router },
      h(PathnameContext.Provider, { value: pathname },
        h(PreferencesProvider, null,
          h(BoardLayout, null, h("main", { "data-testid": "page" }, "Page"))))),
  );
}

/** The opening tag of the frame's region, and the HTML that follows it. */
function region(html, name) {
  const m = html.match(new RegExp(`<div[^>]*\\sdata-layout="${name}"[^>]*>`));
  assert.ok(m, `no data-layout="${name}" region in the frame`);
  return { tag: m[0], after: html.slice(m.index + m[0].length) };
}

const classes = (tag) => (attr(tag, "class") ?? "").split(/\s+/).filter(Boolean);

/**
 * Hidden on a phone before JS runs. max-[768px] is width < 768px, the same
 * query as SidebarContext's isMobile. A rem breakpoint like max-md isn't: it
 * moves with the browser's font size, so the two could disagree on a desktop.
 */
const hiddenOnPhone = (tag) => classes(tag).includes("max-[768px]:hidden");
/** Hidden on a desktop: any unprefixed or md+ display:none. */
const hiddenOnDesktop = (tag) => classes(tag).some((c) => /^(?:md:|lg:|xl:|2xl:)?hidden$/.test(c));

for (const path of ["/stratus-labs/agentboard", "/today", "/c/AB-155"]) {
  test(`${path}: a phone gets the page alone from the server's HTML`, () => {
    const html = render(path);
    const sidebar = region(html, "sidebar");
    const page = region(html, "page");
    assert.ok(hiddenOnPhone(sidebar.tag), `sidebar region should be hidden on a phone: ${sidebar.tag}`);
    assert.ok(!hiddenOnPhone(page.tag), `page region should show on a phone: ${page.tag}`);
    assert.match(page.after, /^<main data-testid="page">/, "the page renders inside its region");
  });
}

test("/: a phone gets the sidebar alone, full width, from the server's HTML", () => {
  const html = render("/");
  const sidebar = region(html, "sidebar");
  const page = region(html, "page");
  assert.ok(!hiddenOnPhone(sidebar.tag), `sidebar region should show on a phone: ${sidebar.tag}`);
  assert.ok(hiddenOnPhone(page.tag), `page region should be hidden on a phone: ${page.tag}`);
  // The sidebar's own box: 256px on a desktop, the whole width on a phone.
  const box = sidebar.after.match(/^<div[^>]*>/)?.[0] ?? "";
  assert.ok(classes(box).includes("w-64"), `sidebar is 256px on a desktop: ${box}`);
  assert.ok(classes(box).includes("max-[768px]:w-full"), `sidebar fills a phone: ${box}`);
});

for (const path of ["/", "/stratus-labs/agentboard"]) {
  test(`${path}: a desktop still gets the sidebar beside the page, with no extra box`, () => {
    const html = render(path);
    for (const name of ["sidebar", "page"]) {
      const { tag } = region(html, name);
      assert.ok(!hiddenOnDesktop(tag), `${name} region should show on a desktop: ${tag}`);
      // display: contents, so the sidebar and the page stay the frame's flex items.
      assert.ok(classes(tag).includes("contents"), `${name} region should not add a box: ${tag}`);
    }
  });
}

test("isMobile and the phone classes use one breakpoint, in px", () => {
  // Tailwind compiles max-[768px]: to @media not all and (min-width: 768px).
  assert.equal(PHONE_QUERY, "not all and (min-width: 768px)");
});
