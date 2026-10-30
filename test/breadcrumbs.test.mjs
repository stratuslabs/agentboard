// The full card page has breadcrumbs instead of a back arrow (card 805). The
// product and board crumbs are real links, so they open in a new tab with
// cmd-click, and the board crumb has to land on that board, not the product's
// first one. These are the pure parts: the hrefs, reading the board back out
// of the URL, and telling a plain click (handled in place) from one the
// browser should handle.
//
//   node --test test/

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  boardHref,
  isPlainClick,
  productHref,
  readBoardParam,
  stripBoardParam,
} from "../src/lib/breadcrumbs.js";

test("productHref is /<org>/<product>, encoded", () => {
  assert.equal(productHref("labs", "agentboard"), "/labs/agentboard");
  assert.equal(productHref("my org", "a/b"), "/my%20org/a%2Fb");
});

test("productHref is null without both slugs", () => {
  assert.equal(productHref("labs", ""), null);
  assert.equal(productHref(undefined, "agentboard"), null);
  assert.equal(productHref(null, null), null);
});

test("boardHref selects the board with ?board=<id>", () => {
  assert.equal(boardHref("labs", "agentboard", 61), "/labs/agentboard?board=61");
});

test("boardHref falls back to the product without a usable board id", () => {
  assert.equal(boardHref("labs", "agentboard", undefined), "/labs/agentboard");
  assert.equal(boardHref("labs", "agentboard", 0), "/labs/agentboard");
  assert.equal(boardHref("labs", "agentboard", -3), "/labs/agentboard");
  assert.equal(boardHref("labs", "agentboard", 1.5), "/labs/agentboard");
  assert.equal(boardHref(undefined, "agentboard", 61), null);
});

test("readBoardParam reads a positive integer board id", () => {
  assert.equal(readBoardParam("?board=61"), 61);
  assert.equal(readBoardParam("?card=805&board=7&view=full"), 7);
  assert.equal(readBoardParam("board=9"), 9);
});

test("readBoardParam ignores anything that isn't a board id", () => {
  for (const s of ["", "?", "?board=", "?board=0", "?board=-1", "?board=1.5", "?board=abc", "?board=1e3", "?card=4"]) {
    assert.equal(readBoardParam(s), null, s);
  }
});

test("stripBoardParam drops board and keeps everything else", () => {
  assert.equal(stripBoardParam("http://x/labs/ab?board=61"), "http://x/labs/ab");
  assert.equal(stripBoardParam("http://x/labs/ab?card=5&board=61&view=full"), "http://x/labs/ab?card=5&view=full");
  assert.equal(stripBoardParam("http://x/labs/ab?card=5#top"), "http://x/labs/ab?card=5#top");
});

const click = (over = {}) => ({ button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false, ...over });

test("isPlainClick: an unmodified primary click", () => {
  assert.equal(isPlainClick(click()), true);
});

test("isPlainClick: modified, middle or already-handled clicks are the browser's", () => {
  assert.equal(isPlainClick(click({ metaKey: true })), false);
  assert.equal(isPlainClick(click({ ctrlKey: true })), false);
  assert.equal(isPlainClick(click({ shiftKey: true })), false);
  assert.equal(isPlainClick(click({ altKey: true })), false);
  assert.equal(isPlainClick(click({ button: 1 })), false);
  assert.equal(isPlainClick(click({ defaultPrevented: true })), false);
});
