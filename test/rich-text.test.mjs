// Card descriptions are plain text that people and agents write with
// markdown habits: a summary line, short lists, links. parseRichText turns
// that into a small block tree the app renders. It never produces HTML, so
// nothing in a description can inject markup.
//
//   node --test test/

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRichText } from "../src/lib/rich-text.js";

const text = (t) => ({ type: "text", text: t });
const para = (...lines) => ({ type: "paragraph", lines });

test("empty and whitespace-only text has no blocks", () => {
  assert.deepEqual(parseRichText(""), []);
  assert.deepEqual(parseRichText("  \n\n \t\n"), []);
  assert.deepEqual(parseRichText(null), []);
});

test("single newlines are line breaks, blank lines split paragraphs", () => {
  assert.deepEqual(parseRichText("one\ntwo\r\n\r\n\nthree"), [
    para([text("one")], [text("two")]),
    para([text("three")]),
  ]);
});

test("a list directly under a label line becomes its own list", () => {
  assert.deepEqual(parseRichText("Details:\n- first\n* second\n• third\nafter"), [
    para([text("Details:")]),
    { type: "list", ordered: false, start: 1, items: [[[text("first")]], [[text("second")]], [[text("third")]]] },
    para([text("after")]),
  ]);
});

test("ordered lists keep their starting number", () => {
  assert.deepEqual(parseRichText("3. c\n4) d"), [
    { type: "list", ordered: true, start: 3, items: [[[text("c")]], [[text("d")]]] },
  ]);
});

test("switching between bullets and numbers starts a new list", () => {
  const blocks = parseRichText("- a\n1. b");
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].ordered, false);
  assert.equal(blocks[1].ordered, true);
});

test("indented lines continue the list item above", () => {
  assert.deepEqual(parseRichText("- item\n  more of it\n- next"), [
    { type: "list", ordered: false, start: 1, items: [[[text("item")], [text("more of it")]], [[text("next")]]] },
  ]);
});

test("things that only look like list markers stay text", () => {
  assert.deepEqual(parseRichText("-not a list\n1.5 is a number\n--flag"), [
    para([text("-not a list")], [text("1.5 is a number")], [text("--flag")]),
  ]);
});

test("headings", () => {
  assert.deepEqual(parseRichText("## Done when\ntext\n####### too deep"), [
    { type: "heading", level: 2, content: [text("Done when")] },
    para([text("text")], [text("####### too deep")]),
  ]);
});

test("bare URLs become links without trailing punctuation", () => {
  assert.deepEqual(parseRichText("See https://github.com/stratuslabs/agentboard/pull/44."), [
    para([
      text("See "),
      { type: "link", href: "https://github.com/stratuslabs/agentboard/pull/44", children: [text("https://github.com/stratuslabs/agentboard/pull/44")] },
      text("."),
    ]),
  ]);
});

test("a URL in parentheses keeps balanced parens only", () => {
  const [{ lines }] = parseRichText("(https://en.wikipedia.org/wiki/Foo_(bar)) and (https://x.dev/a)");
  const links = lines[0].filter((n) => n.type === "link").map((n) => n.href);
  assert.deepEqual(links, ["https://en.wikipedia.org/wiki/Foo_(bar)", "https://x.dev/a"]);
});

test("markdown links, code and bold", () => {
  assert.deepEqual(parseRichText("Run `task link` per [the docs](https://agentboard.to/docs), **now**."), [
    para([
      text("Run "),
      { type: "code", text: "task link" },
      text(" per "),
      { type: "link", href: "https://agentboard.to/docs", children: [text("the docs")] },
      text(", "),
      { type: "strong", children: [text("now")] },
      text("."),
    ]),
  ]);
});

test("only http, https and mailto links are linked", () => {
  for (const href of ["javascript:alert(1)", "data:text/html,hi", "/relative", "JaVaScRiPt:alert(1)"]) {
    const [{ lines }] = parseRichText(`[x](${href})`);
    assert.ok(lines[0].every((n) => n.type !== "link"), href);
    assert.equal(lines[0].map((n) => n.text).join(""), `[x](${href})`);
  }
  const [{ lines }] = parseRichText("[mail](mailto:dev@example.com)");
  assert.equal(lines[0][0].href, "mailto:dev@example.com");
});

test("code spans are not parsed further", () => {
  assert.deepEqual(parseRichText("`**x** https://a.b`"), [para([{ type: "code", text: "**x** https://a.b" }])]);
});

test("unclosed markers are left as text", () => {
  assert.deepEqual(parseRichText("a ** b ` c [d](e"), [para([text("a ** b ` c [d](e")])]);
});

test("every character of the source survives as text somewhere", () => {
  // Rendering may drop markers (`, **, [](), list bullets) but never words.
  const src = "Fix it\n\n- step one https://a.dev/x\n- step `two`\n\n1. **bold** [l](https://b.dev)";
  const flat = JSON.stringify(parseRichText(src));
  for (const word of ["Fix", "it", "step", "one", "https://a.dev/x", "two", "bold", "l", "https://b.dev"]) {
    assert.ok(flat.includes(word), word);
  }
});

test("a scheme with nothing after it is not a link", () => {
  const [{ lines }] = parseRichText("https:// and mailto:");
  assert.ok(lines[0].every((n) => n.type === "text"));
});
