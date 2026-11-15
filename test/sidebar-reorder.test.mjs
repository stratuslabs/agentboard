// The sidebar's org and product rows reorder by drag. dnd-kit's default
// attributes used to make each whole row a role="button" with tabindex=0 that
// also held the row's link and buttons: axe calls that nested-interactive
// (WCAG 4.1.2), and the row was a tab stop that did nothing, since only the
// pointer could drag (AB-154). The row still drags by pointer; a separate
// Move handle carries the sortable role and the keyboard.
//
//   node --test test/

import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./support/ts-loader.mjs", import.meta.url);

const { createElement: h } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { DndContext } = await import("@dnd-kit/core");
const { SortableContext } = await import("@dnd-kit/sortable");
const { SortableOrgHeader, SortableProductItem, canDropOn } = await import("../src/components/Sidebar.tsx");
const { attr, nestedInteractive } = await import("./support/nested-interactive.mjs");

const noop = () => {};
const org = { id: 3, name: "Stratus Labs", slug: "stratus-labs", position: 0 };
const product = { id: 9, org_id: 3, name: "AgentBoard", slug: "agentboard", emoji: "🧭", position: 0 };

function sortable(id, row) {
  return renderToStaticMarkup(h(DndContext, null, h(SortableContext, { items: [id] }, row)));
}

const orgRow = () => sortable(`org-${org.id}`, h(SortableOrgHeader, {
  org, expanded: true, onToggle: noop, onContextMenu: noop,
  isEditing: false, editingName: "", editError: null, onEditChange: noop, onEditSubmit: noop, onEditCancel: noop,
  onMenuClick: noop, menuOpen: false,
}));

const productRow = () => sortable(`product-${product.id}`, h(SortableProductItem, {
  product, isSelected: false, href: "/stratus-labs/agentboard", onContextMenu: noop,
  isEditing: false, editingName: "", editError: null, onEditChange: noop, onEditSubmit: noop, onEditCancel: noop,
  emojiPickerOpen: false, onEmojiToggle: noop, onEmojiChange: noop,
}));

/** Every opening tag that dnd-kit marked as the sortable control. */
const sortableControls = (html) => [...html.matchAll(/<[a-z]+\b[^>]*\saria-roledescription="sortable"[^>]*>/g)].map((m) => m[0]);

for (const [kind, render, name] of [["org", orgRow, org.name], ["product", productRow, product.name]]) {
  test(`${kind} row: no link or button is nested inside another control`, () => {
    assert.deepEqual(nestedInteractive(render()), []);
  });

  test(`${kind} row: one Move handle, a button, is the sortable control`, () => {
    const controls = sortableControls(render());
    assert.equal(controls.length, 1, `sortable controls: ${controls.join(" | ")}`);
    const [handle] = controls;
    assert.match(handle, /^<button\b/, `handle is not a button: ${handle}`);
    assert.equal(attr(handle, "aria-label"), `Move ${name}`);
    assert.ok(attr(handle, "aria-describedby"), "handle should point at the keyboard instructions");
  });

  test(`${kind} row: the row itself is not a button or a tab stop`, () => {
    const html = render();
    const row = html.match(new RegExp(`<div\\b[^>]*\\sclass="[^"]*group/${kind}\\b[^"]*"[^>]*>`))?.[0];
    assert.ok(row, `no group/${kind} row`);
    assert.equal(attr(row, "role"), undefined, `row has a role: ${row}`);
    assert.equal(attr(row, "tabindex"), undefined, `row is focusable: ${row}`);
  });
}

test("org row keeps its toggle and options buttons", () => {
  const html = orgRow();
  assert.match(html, /<button\b[^>]*>(?:(?!<\/button>)[\s\S])*Stratus Labs/);
  assert.match(html, /aria-label="Stratus Labs options"/);
});

test("product row keeps its link and emoji button", () => {
  const html = productRow();
  assert.match(html, /<a\b[^>]*href="\/stratus-labs\/agentboard"/);
  assert.match(html, /aria-label="Change emoji for AgentBoard"/);
});

test("an org drops only on orgs; a product drops on products and org zones", () => {
  assert.equal(canDropOn("org-1", "org-2"), true);
  assert.equal(canDropOn("org-1", "org-1"), true);
  assert.equal(canDropOn("org-1", "org-drop-2"), false);
  assert.equal(canDropOn("org-1", "product-4"), false);
  assert.equal(canDropOn("product-4", "product-5"), true);
  assert.equal(canDropOn("product-4", "org-drop-2"), true);
  assert.equal(canDropOn("product-4", "org-2"), false);
  assert.equal(canDropOn("product-4", "product-x"), false);
  assert.equal(canDropOn("card-1", "org-2"), false);
});
