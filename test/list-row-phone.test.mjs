// Rows on Today, Assigned to me and Past Due are one 44px line: priority, key,
// title, status, assignee, due date. On a phone the key, status, avatar and due
// date kept their width and the title got what was left, a few characters
// ("Write t…"), or nothing at all next to a long column name, so cards couldn't
// be told apart without opening them (AB-158). A phone row is now two lines:
// the title gets the row's width (up to two lines), and the key, status,
// assignee and due date sit under it. Desktop rows are unchanged.
//
// These tests read the server's HTML; the measured layout at 390px and 1440px
// is checked in a browser (see the PR).
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
const { SidebarProvider } = await import("../src/contexts/SidebarContext.tsx");
const { default: ListView } = await import("../src/components/ListView.tsx");
const { attr } = await import("./support/nested-interactive.mjs");

const router = { push() {}, replace() {}, prefetch() {}, back() {}, forward() {}, refresh() {} };

const card = {
  id: 7, number: 7, product_key: "AB", title: "Write the launch post for the AgentBoard Cloud release",
  priority: "high", due_date: "2026-11-15", assignee_name: "Dana", assignee_color: "#888",
  column_name: "Waiting on review from Dylan", column_color: "#a855f7",
  org_name: "Labs", product_name: "AgentBoard", product_emoji: "", board_name: "Development",
};

function render(cards) {
  return renderToStaticMarkup(
    h(AppRouterContext.Provider, { value: router },
      h(PathnameContext.Provider, { value: "/assigned" },
        h(PreferencesProvider, null,
          h(SidebarProvider, null,
            h(ListView, { cards, title: "Assigned to me", icon: h("svg"), emptyMessage: "None.", onRefresh() {} }))))),
  );
}

/** The row button's HTML for the card, and its parts' opening tags in order. */
function row(c = card) {
  const html = render([c]);
  const m = html.match(new RegExp(`<button[^>]*>((?:(?!</button>).)*${c.title}(?:(?!</button>).)*)</button>`));
  assert.ok(m, "no row button for the card");
  const open = m[0].match(/^<button[^>]*>/)[0];
  // The row's direct children: opening tags at depth 1.
  const kids = [];
  let depth = 0;
  for (const t of m[1].matchAll(/<(\/?)([a-z][a-z0-9]*)\b[^>]*?(\/?)>/g)) {
    const [tag, closing, name, self] = t;
    if (closing) { depth--; continue; }
    if (depth === 0) kids.push({ tag, name });
    if (!self) depth++;
  }
  return { html: m[0], open, kids };
}

const classes = (tag) => (attr(tag, "class") ?? "").split(/\s+/).filter(Boolean);
const phone = (tag) => classes(tag).filter((c) => c.startsWith("max-md:")).map((c) => c.slice(7));
const desktop = (tag) => classes(tag).filter((c) => !c.startsWith("max-md:"));

test("on a phone the row is a grid, at least 44px tall", () => {
  const { open } = row();
  assert.ok(phone(open).includes("grid"), `phone classes: ${phone(open).join(" ")}`);
  assert.ok(phone(open).includes("h-auto") && phone(open).includes("min-h-11"), "a phone row grows past 44px but never below it");
});

test("on a phone the title has the first line to itself and may wrap to two", () => {
  const { kids } = row();
  const title = kids.find((k) => k.name === "span" && classes(k.tag).includes("truncate"));
  assert.ok(title, "no title span");
  const p = phone(title.tag);
  assert.ok(p.includes("row-start-1"), "title on the first line");
  assert.ok(p.includes("col-span-4"), "title spans the row past the priority dot");
  assert.ok(p.includes("line-clamp-2") && p.includes("whitespace-normal"), "title wraps to two lines instead of truncating");
});

test("on a phone the key, status, assignee and due date sit on the second line", () => {
  const { kids } = row();
  // dot, key, title, status, avatar, due
  assert.equal(kids.length, 6, kids.map((k) => k.tag).join("\n"));
  const [, key, , status, avatar, due] = kids;
  for (const [name, k] of Object.entries({ key, status, avatar, due })) {
    assert.ok(phone(k.tag).includes("row-start-2"), `${name} on the second line: ${k.tag}`);
  }
});

test("a long column name truncates on a phone instead of crowding out the rest", () => {
  const { kids, html } = row();
  const status = kids[3];
  assert.ok(phone(status.tag).includes("min-w-0") && phone(status.tag).includes("max-w-full"), status.tag);
  assert.match(html, new RegExp(`<span class="[^"]*\\btruncate\\b[^"]*">${card.column_name}</span>`));
});

test("an unassigned card keeps the avatar's place on the second line", () => {
  const { kids } = row({ ...card, assignee_name: null, title: "Triage new issues" });
  assert.ok(phone(kids[4].tag).includes("row-start-2"), kids[4].tag);
});

test("desktop rows keep their one-line layout", () => {
  const { open, kids } = row();
  assert.deepEqual(desktop(open).slice(0, 12), ["flex", "h-11", "w-full", "items-center", "gap-3", "rounded-lg", "border", "px-3.5", "text-left", "transition-colors", "hover:border-border-strong", "hover:bg-surface-2"]);
  const title = kids.find((k) => classes(k.tag).includes("truncate"));
  assert.deepEqual(desktop(title.tag), ["min-w-0", "flex-1", "truncate", "text-[13.5px]", "text-text-1"]);
});
