// Every dialog has an accessible name, so a screen reader opening "Delete
// card" says "Delete card, dialog" instead of just "dialog" (AB-138). Dialog
// takes the name as `labelledBy` (the id of its visible title) or `label`
// (when there's no title to point at), and every dialog in the app passes one.
//
//   node --test test/

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "node:module";

register("./support/ts-loader.mjs", import.meta.url);
// Dialog portals to document.body, which a server render can't do. Hand it a
// createPortal that renders in place, so the markup it would portal is what
// renderToStaticMarkup returns. The document.body it passes is never read.
globalThis.document ??= { body: null };
register(
  "data:text/javascript," +
    encodeURIComponent(`
      export async function resolve(specifier, context, next) {
        if (specifier === "react-dom" && /\\/ui\\/Dialog\\.tsx$/.test(context.parentURL ?? "")) {
          return { url: "data:text/javascript," + encodeURIComponent("export const createPortal = (children) => children;"), shortCircuit: true };
        }
        return next(specifier, context);
      }
    `),
);

const { createElement: h } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { Dialog } = await import("../src/components/ui/Dialog.tsx");
const { default: ConfirmModal } = await import("../src/components/ConfirmModal.tsx");

const noop = () => {};

/** The opening tag of the role="dialog" element in some markup. */
function dialogTag(html) {
  const tag = html.match(/<[a-z]+\b[^>]*\brole="dialog"[^>]*>/);
  assert.ok(tag, `no role="dialog" element in ${html}`);
  return tag[0];
}

const attr = (tag, name) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];

/** The text of the element with this id, tags stripped. */
function textOfId(html, id) {
  const open = html.match(new RegExp(`<([a-z0-9]+)\\b[^>]*\\sid="${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*>`));
  assert.ok(open, `no element with id="${id}"`);
  const rest = html.slice(open.index + open[0].length);
  return rest.slice(0, rest.indexOf(`</${open[1]}>`)).replace(/<[^>]+>/g, "").trim();
}

test("Dialog names itself after the element labelledBy points at", () => {
  const html = renderToStaticMarkup(
    h(Dialog, { onClose: noop, labelledBy: "t" }, h("h3", { id: "t" }, "Delete card")),
  );
  const tag = dialogTag(html);
  assert.equal(attr(tag, "aria-labelledby"), "t");
  assert.equal(attr(tag, "aria-label"), undefined);
  assert.equal(textOfId(html, "t"), "Delete card");
});

test("Dialog takes a plain label when there is no visible title", () => {
  const tag = dialogTag(renderToStaticMarkup(h(Dialog, { onClose: noop, label: "Search cards" }, "…")));
  assert.equal(attr(tag, "aria-label"), "Search cards");
  assert.equal(attr(tag, "aria-labelledby"), undefined);
});

test("a visible title wins over a plain label, so the two can't disagree", () => {
  const tag = dialogTag(renderToStaticMarkup(h(Dialog, { onClose: noop, labelledBy: "t", label: "Other" }, h("h3", { id: "t" }, "Title"))));
  assert.equal(attr(tag, "aria-labelledby"), "t");
  assert.equal(attr(tag, "aria-label"), undefined);
});

test("ConfirmModal is named by its title, so 'Delete card' is announced as such", () => {
  const html = renderToStaticMarkup(
    h(ConfirmModal, { title: "Delete card", message: "This can't be undone.", onConfirm: noop, onCancel: noop }),
  );
  const id = attr(dialogTag(html), "aria-labelledby");
  assert.ok(id, "the dialog has aria-labelledby");
  assert.equal(textOfId(html, id), "Delete card");
});

test("two ConfirmModals on one page get different title ids", () => {
  const one = (title) => h(ConfirmModal, { title, message: "m", onConfirm: noop, onCancel: noop });
  const html = renderToStaticMarkup(h("div", null, one("Delete card"), one("Remove member")));
  const ids = [...html.matchAll(/<[a-z]+\b[^>]*\brole="dialog"[^>]*>/g)].map((m) => attr(m[0], "aria-labelledby"));
  assert.equal(ids.length, 2);
  assert.notEqual(ids[0], ids[1]);
  assert.deepEqual(ids.map((id) => textOfId(html, id)), ["Delete card", "Remove member"]);
});

// The rest of the app's dialogs need live data or context to render, so this
// checks their source instead: every <Dialog> passes a name.
const SRC = fileURLToPath(new URL("../src", import.meta.url));
function* tsxFiles(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* tsxFiles(path);
    else if (name.endsWith(".tsx")) yield path;
  }
}

/** Each <Dialog …> opening tag in some TSX, up to the ">" outside any {…}. */
function* dialogTags(source) {
  for (const m of source.matchAll(/<Dialog\b/g)) {
    let depth = 0;
    let i = m.index;
    for (; i < source.length; i++) {
      const c = source[i];
      if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) break;
    }
    yield source.slice(m.index, i + 1);
  }
}

test("every <Dialog> in the app passes labelledBy or label", () => {
  const unnamed = [];
  let seen = 0;
  for (const file of tsxFiles(SRC)) {
    for (const tag of dialogTags(readFileSync(file, "utf8"))) {
      seen++;
      if (!/\s(labelledBy|label)=/.test(tag)) unnamed.push(`${file.slice(SRC.length + 1)}: ${tag.replace(/\s+/g, " ").slice(0, 100)}`);
    }
  }
  assert.ok(seen >= 4, `expected the app's dialogs, found ${seen}`);
  assert.deepEqual(unnamed, []);
});
