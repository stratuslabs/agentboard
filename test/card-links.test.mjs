// Card links: any http(s) URL a card points at, such as a Slack thread, a doc
// or a design, next to the GitHub issue and PR fields. The API validates every
// link with these rules, so a link the CLI sends is one the app can open.
//
//   node --test test/

import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_LINK_TITLE, MAX_LINK_URL, linkLabel, parseCardLink, parseLinkUrl } from "../src/lib/card-links.js";

test("any http(s) URL is accepted, trimmed and kept as written", () => {
  for (const url of [
    "https://stratuslabs.slack.com/archives/C0123456789/p1791332967606559",
    "https://docs.google.com/document/d/abc/edit#heading=h.1",
    "https://www.figma.com/design/XYZ/AgentBoard?node-id=1-2",
    "http://localhost:3000/c/42",
    "https://github.com/stratuslabs/agentboard/pull/67",
  ]) {
    assert.deepEqual(parseCardLink({ url: `  ${url} ` }), { ok: true, value: { url, title: null } });
  }
});

test("a URL that isn't http(s) is rejected, so a stored link can't run script", () => {
  for (const url of ["javascript:alert(1)", "JavaScript:alert(1)", "data:text/html,hi", "file:///etc/passwd", "ftp://x.test/a", "mailto:a@b.test"]) {
    const r = parseCardLink({ url });
    assert.equal(r.ok, false, `${url} should be rejected`);
    assert.match(r.error, /http/);
  }
});

test("url is required, must be a string and must parse", () => {
  for (const url of [undefined, null, "", "   ", 42, "not a url", "slack thread", "//example.com/x"]) {
    const r = parseCardLink({ url });
    assert.equal(r.ok, false, `${JSON.stringify(url)} should be rejected`);
    assert.match(r.error, /url/);
  }
  for (const body of [null, undefined, "https://x.test", 3, []]) {
    assert.equal(parseCardLink(body).ok, false);
  }
});

test("url must start with http:// or https://, not just parse as one", () => {
  // new URL() accepts these, but the stored string is rendered as an href,
  // where a browser resolves them as same-origin paths, not the intended site.
  for (const url of ["https:example.com", "https:/example.com", "http:example.com/a", "https:\\\\example.com"]) {
    const r = parseLinkUrl(url);
    assert.equal(r.ok, false, `${url} should be rejected`);
    assert.match(r.error, /http:\/\/ or https:\/\//);
  }
  assert.deepEqual(parseLinkUrl("HTTPS://Example.com/A"), { ok: true, value: "HTTPS://Example.com/A" });
});

test("url is at most MAX_LINK_URL characters", () => {
  const base = "https://x.test/";
  assert.equal(parseLinkUrl(base + "a".repeat(MAX_LINK_URL - base.length)).ok, true);
  const long = parseLinkUrl(base + "a".repeat(MAX_LINK_URL - base.length + 1));
  assert.equal(long.ok, false);
  assert.match(long.error, new RegExp(String(MAX_LINK_URL)));
});

test("title is optional, one line, and capped", () => {
  assert.deepEqual(parseCardLink({ url: "https://x.test", title: "  Launch\n thread " }).value, {
    url: "https://x.test",
    title: "Launch thread",
  });
  for (const title of [undefined, null, "", "  "]) {
    assert.equal(parseCardLink({ url: "https://x.test", title }).value.title, null);
  }
  assert.equal(parseCardLink({ url: "https://x.test", title: 7 }).ok, false);
  assert.equal(parseCardLink({ url: "https://x.test", title: "t".repeat(MAX_LINK_TITLE) }).ok, true);
  const long = parseCardLink({ url: "https://x.test", title: "t".repeat(MAX_LINK_TITLE + 1) });
  assert.equal(long.ok, false);
  assert.match(long.error, /title/);
});

test("a link shows its title, else its host and path without the scheme", () => {
  assert.equal(linkLabel({ url: "https://x.test/a", title: "Spec" }), "Spec");
  assert.equal(linkLabel({ url: "https://www.figma.com/design/XYZ", title: null }), "www.figma.com/design/XYZ");
  assert.equal(linkLabel({ url: "http://x.test/", title: null }), "x.test");
});
