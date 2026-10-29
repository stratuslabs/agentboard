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
