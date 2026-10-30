// Card references in descriptions: typing AB-142 (or "card #57" for a card
// without a key) renders a link to that card's permanent URL, /c/AB-142, which
// the app resolves to wherever the card lives now. Nothing is looked up while
// parsing, so a reference to a card that doesn't exist opens the not-found
// page, the same as a stale link would.
//
//   node --test test/

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseInline, parseRichText } from "../src/lib/rich-text.js";

const text = (t) => ({ type: "text", text: t });
const card = (ref, label = ref) => ({ type: "card", ref, children: [text(label)] });

test("a card key becomes a link to its permanent URL", () => {
  assert.deepEqual(parseInline("Blocked by AB-142."), [text("Blocked by "), card("AB-142"), text(".")]);
});

test("keys with digits and longer prefixes link, several per line", () => {
  assert.deepEqual(parseInline("OKB2-7, AB-1 and WEBAPP-12"), [
    card("OKB2-7"),
    text(", "),
    card("AB-1"),
    text(" and "),
    card("WEBAPP-12"),
  ]);
});

test("references in lists, headings and bold link too", () => {
  const [list, heading] = parseRichText("- see AB-3\n\n## AB-4 follow-up");
  assert.deepEqual(list.items[0][0], [text("see "), card("AB-3")]);
  assert.deepEqual(heading.content, [card("AB-4"), text(" follow-up")]);
  assert.deepEqual(parseInline("**after AB-9**"), [{ type: "strong", children: [text("after "), card("AB-9")] }]);
});

test("lowercase and mixed-case look-alikes stay text", () => {
  for (const s of ["ab-142", "Ab-142", "aB-142", "utf-8 text", "covid-19"]) {
    assert.deepEqual(parseInline(s), [text(s)], s);
  }
});

test("a key glued to other text, versions and ranges stay text", () => {
  for (const s of [
    "xAB-142",
    "AB-142x",
    "AB-142_x",
    "repo/AB-142",
    "#AB-142",
    "@AB-142",
    "v.AB-142",
    "AB-0",
    "AB-01",
    "A-12",
    "AB-12-3",
    "AB-12.5",
    "X-AB-12",
    "ABCDEFGHIJK-1",
  ]) {
    assert.deepEqual(parseInline(s), [text(s)], s);
  }
});

test("common standards and time-zone names are not card keys", () => {
  for (const s of ["UTF-8", "ISO-8601", "SHA-256", "CVE-2026", "RFC-9110", "HTTP-2", "TLS-13", "UTC-5", "GMT-8", "PEP-8", "ES-2022", "GPT-5"]) {
    assert.deepEqual(parseInline(s), [text(s)], s);
  }
});

test("a real product key links even when it reads like a standard", () => {
  // A product named "Transport Layer Security" derives the key TLS. When the
  // caller says which keys are real, those win over the standards stoplist.
  const opts = { cardKeys: ["TLS", "UTC"] };
  assert.deepEqual(parseInline("Blocked by TLS-13.", opts), [text("Blocked by "), card("TLS-13"), text(".")]);
  assert.deepEqual(parseInline("UTC-5 and AB-2", opts), [card("UTC-5"), text(" and "), card("AB-2")]);
  // Keys not in the list still follow the stoplist.
  assert.deepEqual(parseInline("UTF-8", opts), [text("UTF-8")]);
  // Inside bold, too.
  assert.deepEqual(parseInline("**TLS-13**", opts), [{ type: "strong", children: [card("TLS-13")] }]);
});

test("parseRichText passes the real keys to every block", () => {
  const blocks = parseRichText("# TLS-1\n\n- TLS-2\n\nSee TLS-3", { cardKeys: ["TLS"] });
  assert.deepEqual(blocks, [
    { type: "heading", level: 1, content: [card("TLS-1")] },
    { type: "list", ordered: false, start: 1, items: [[[card("TLS-2")]]] },
    { type: "paragraph", lines: [[text("See "), card("TLS-3")]] },
  ]);
});

test("code spans, link labels and URLs keep keys as written", () => {
  assert.deepEqual(parseInline("`AB-142`"), [{ type: "code", text: "AB-142" }]);
  assert.deepEqual(parseInline("[AB-142](https://example.com/x)"), [
    { type: "link", href: "https://example.com/x", children: [text("AB-142")] },
  ]);
  assert.deepEqual(parseInline("https://example.com/AB-142"), [
    { type: "link", href: "https://example.com/AB-142", children: [text("https://example.com/AB-142")] },
  ]);
});

test("'card #57' links the #57 to the card with that id", () => {
  assert.deepEqual(parseInline("Moved from card #57."), [text("Moved from card "), card("57", "#57"), text(".")]);
  assert.deepEqual(parseInline("Card #8 and cards #9"), [text("Card "), card("8", "#8"), text(" and cards "), card("9", "#9")]);
});

test("a bare #57 stays text: in this team it usually means a PR or issue", () => {
  for (const s of ["PR #57", "#57", "agentboard#78", "see #12 and #13", "card #0", "card #57x", "discard #57"]) {
    assert.deepEqual(parseInline(s), [text(s)], s);
  }
});

test("with links off, references stay text", () => {
  assert.deepEqual(parseInline("AB-142 and card #5", { links: false }), [text("AB-142 and card #5")]);
});

test("a rejected Markdown link stays exactly as written, label included", () => {
  for (const s of ["[AB-142](/cards/42)", "[AB-142](javascript:alert)", "[see AB-142](ftp://host/x)"]) {
    assert.deepEqual(parseInline(s), [text(s)], s);
  }
  assert.deepEqual(parseInline("[AB-142](/x) then AB-7"), [text("[AB-142](/x) then "), card("AB-7")]);
});

test("a key that starts a path or an address stays text", () => {
  for (const s of ["AB-142/path", "owner+AB-142@example.com", "AB-142@host"]) {
    assert.deepEqual(parseInline(s), [text(s)], s);
  }
});

test("a key that starts a hostname or file name stays text", () => {
  for (const s of ["AB-142.example.com", "AB-142.internal/path", "see AB-142.md"]) {
    assert.deepEqual(parseInline(s), [text(s)], s);
  }
});

test("a key ending a sentence still links", () => {
  assert.deepEqual(parseInline("Done in AB-142. Next is AB-143."), [
    text("Done in "),
    card("AB-142"),
    text(". Next is "),
    card("AB-143"),
    text("."),
  ]);
  assert.deepEqual(parseInline("(AB-142.)"), [text("("), card("AB-142"), text(".)")]);
});

// The boundary is an allowlist: a key links only when it stands alone as a
// word, with nothing on either side but whitespace, brackets, quotes or
// sentence punctuation. Anything else glued to it (an address, a path, a
// query, an operator) keeps the whole thing as text.
test("a key glued to any other character stays text", () => {
  for (const c of ["+", "=", "~", "*", "%", "&", "$", "^", "|", "\\", "-", "_", "/", "@", "#", ":", "."]) {
    assert.deepEqual(parseInline(`${c}AB-142`), [text(`${c}AB-142`)], `${c}AB-142`);
  }
  for (const c of ["+", "=", "~", "*", "%", "&", "$", "^", "|", "\\", "#", "/", "@"]) {
    assert.deepEqual(parseInline(`AB-142${c}x`), [text(`AB-142${c}x`)], `AB-142${c}x`);
  }
  for (const s of ["AB-142+alerts@example.com", "AB-142:8080", "AB-142?x=1", "AB-142!x", "AB-142;x", "AB-142,x", "card #57+x", "card #57.md", "card #57/x"]) {
    assert.deepEqual(parseInline(s), [text(s)], s);
  }
});

test("brackets, quotes and sentence punctuation around a key are fine", () => {
  assert.deepEqual(parseInline("(AB-142)"), [text("("), card("AB-142"), text(")")]);
  assert.deepEqual(parseInline("[AB-142]"), [text("["), card("AB-142"), text("]")]);
  assert.deepEqual(parseInline("\"AB-142\""), [text("\""), card("AB-142"), text("\"")]);
  assert.deepEqual(parseInline("“AB-142”"), [text("“"), card("AB-142"), text("”")]);
  assert.deepEqual(parseInline("AB-142's owner"), [card("AB-142"), text("'s owner")]);
  assert.deepEqual(parseInline("AB-142: fix it"), [card("AB-142"), text(": fix it")]);
  assert.deepEqual(parseInline("AB-142? AB-143! AB-144;"), [
    card("AB-142"), text("? "), card("AB-143"), text("! "), card("AB-144"), text(";"),
  ]);
  assert.deepEqual(parseInline("see card #57, then AB-1"), [text("see card "), card("57", "#57"), text(", then "), card("AB-1")]);
});

test("every printable ASCII neighbor: only the allowed ones let a key link", () => {
  const opens = new Set([" ", "(", "[", "{", "<", "\"", "'"]);
  const closes = new Set([" ", ")", "]", "}", ">", "\"", "'"]);
  // Checks the ref, not just "some card": AAB-142 is a different, valid key.
  const linked = (s) => parseInline(s).some((n) => n.type === "card" && n.ref === "AB-142");
  for (let code = 0x21; code <= 0x7e; code++) {
    const c = String.fromCharCode(code);
    // Before the key. Backtick and [ ... ]( ... ) are code and links, not plain text.
    if (c !== "`") assert.equal(linked(`x ${c}AB-142 y`), opens.has(c), `before: ${c}`);
    // After the key, with a letter after that so punctuation isn't a sentence end.
    if (c !== "`") assert.equal(linked(`x AB-142${c}y`), closes.has(c), `after: ${c}`);
  }
});
