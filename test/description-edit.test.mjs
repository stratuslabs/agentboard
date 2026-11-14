// A card's formatted description holds links, so it can't also be a button:
// axe calls that nested-interactive (WCAG 4.1.2), and a screen reader may read
// the whole description as one "Edit description" button and hide the links
// inside it (AB-151). The description is plain text with its links, and a
// separate Edit button opens the editor. Clicking the text still edits.
//
//   node --test test/

import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./support/ts-loader.mjs", import.meta.url);

const { createElement: h } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { default: CardDetail } = await import("../src/components/CardDetail.tsx");

const noop = () => {};
const card = {
  id: 7,
  column_id: 1,
  title: "Fix the thing",
  description: "Follows AB-2. See https://example.com/spec and [the doc](https://example.com/doc).",
  assignee: null,
  assignee_id: null,
  assignee_name: null,
  assignee_type: null,
  assignee_color: null,
  priority: "medium",
  labels: "",
  github_issue_url: null,
  github_pr_url: null,
  due_date: null,
  position: 0,
  created_at: "2026-11-14T00:00:00Z",
  updated_at: "2026-11-14T00:00:00Z",
  number: 7,
  key: "AB-7",
};

function render(mode) {
  return renderToStaticMarkup(
    h(CardDetail, {
      card,
      mode,
      columns: [{ id: 1, board_id: 1, name: "Todo", slug: "todo", position: 0 }],
      context: { productName: "AgentBoard", productKey: "AB" },
      onNavigate: noop,
      onClose: noop,
      onToggleMode: noop,
      onUpdate: noop,
      onDelete: noop,
    }),
  );
}

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
const attr = (tag, name) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];

/** True when an element is interactive the way axe's nested-interactive rule means it. */
function interactive(name, tag) {
  if (name === "a" && attr(tag, "href") !== undefined) return true;
  if (["button", "input", "select", "textarea"].includes(name)) return true;
  const role = attr(tag, "role");
  if (role && /^(button|link|checkbox|menuitem|option|radio|switch|tab|textbox)$/.test(role)) return true;
  const tabindex = attr(tag, "tabindex");
  return tabindex !== undefined && Number(tabindex) >= 0;
}

/** Each interactive element inside another interactive element, as "outer > inner" opening tags. */
function nestedInteractive(html) {
  const found = [];
  const stack = [];
  for (const m of html.matchAll(/<(\/?)([a-z][a-z0-9-]*)\b[^>]*?(\/?)>/g)) {
    const [tag, closing, name, selfClosing] = m;
    if (closing) {
      const i = stack.findLastIndex((e) => e.name === name);
      if (i >= 0) stack.length = i;
      continue;
    }
    const isInteractive = interactive(name, tag);
    if (isInteractive) {
      const outer = stack.findLast((e) => e.interactive);
      if (outer) found.push(`${outer.tag} > ${tag}`);
    }
    if (!selfClosing && !VOID.has(name)) stack.push({ name, tag, interactive: isInteractive });
  }
  return found;
}

/** The opening tag of the element with this data-testid. */
function byTestId(html, id) {
  const tag = html.match(new RegExp(`<[a-z]+\\b[^>]*\\sdata-testid="${id}"[^>]*>`));
  assert.ok(tag, `no data-testid="${id}" element`);
  return tag[0];
}

for (const mode of ["panel", "page"]) {
  test(`${mode}: the formatted description renders its links`, () => {
    const html = render(mode);
    assert.match(html, /<a\b[^>]*href="https:\/\/example\.com\/spec"/);
    assert.match(html, /<a\b[^>]*href="https:\/\/example\.com\/doc"/);
  });

  test(`${mode}: the description text is not a button, so its links aren't nested in one`, () => {
    const html = render(mode);
    const view = byTestId(html, "description-view");
    assert.equal(attr(view, "role"), undefined, `description view has role: ${view}`);
    assert.equal(attr(view, "tabindex"), undefined, `description view is focusable: ${view}`);
    assert.deepEqual(nestedInteractive(html), []);
  });

  test(`${mode}: a separate Edit description button opens the editor`, () => {
    const html = render(mode);
    const button = html.match(/<button\b[^>]*>(?:(?!<\/button>)[\s\S])*<\/button>/g)?.find((b) => /aria-label="Edit description"/.test(b) || />\s*Edit description\s*</.test(b));
    assert.ok(button, "no Edit description button");
    assert.doesNotMatch(button, /<a\b/, "the Edit button must not contain the links");
  });
}

test("the nested-interactive check catches a role=button wrapper around a link", () => {
  assert.deepEqual(
    nestedInteractive('<div role="button" tabindex="0"><p>See <a href="https://x.test">x</a></p></div>'),
    ['<div role="button" tabindex="0"> > <a href="https://x.test">'],
  );
  assert.deepEqual(nestedInteractive('<div><a href="https://x.test">x</a><button>Edit</button></div>'), []);
});
