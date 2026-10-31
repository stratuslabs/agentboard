// GitHub App (card 1000): the pure parts. Signature check, PR URL
// normalization, card references in a PR body, and the History line.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import {
  verifySignature,
  normalizePrUrl,
  cardRefsInBody,
  closeHistoryLine,
  appendHistory,
} from "../src/lib/github-app.js";

const SECRET = "It's a Secret to Everybody";
const sign = (secret, body) => "sha256=" + createHmac("sha256", secret).update(body).digest("hex");

test("a signature made with the secret over the raw body is accepted", () => {
  const body = Buffer.from('{"action":"closed"}');
  assert.equal(verifySignature(SECRET, body, sign(SECRET, body)), true);
  // GitHub's documented example.
  assert.equal(
    verifySignature(
      SECRET,
      Buffer.from("Hello, World!"),
      "sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17"
    ),
    true
  );
});

test("a wrong, missing or malformed signature is rejected", () => {
  const body = Buffer.from('{"action":"closed"}');
  const good = sign(SECRET, body);
  for (const header of [
    undefined,
    null,
    "",
    "sha256=",
    good.replace("sha256=", "sha1="),
    good.slice(0, -1),
    good.slice(0, -1) + (good.endsWith("0") ? "1" : "0"),
    sign("another secret", body),
    good.toUpperCase(),
    "sha256=zz" + good.slice(9),
  ]) {
    assert.equal(verifySignature(SECRET, body, header), false, String(header));
  }
  // The body is what's signed: a changed body fails.
  assert.equal(verifySignature(SECRET, Buffer.from('{"action":"opened"}'), good), false);
  // No secret configured never verifies anything.
  assert.equal(verifySignature("", body, sign("", body)), false);
});

test("random bodies: only the matching signature verifies", () => {
  for (let i = 0; i < 200; i++) {
    const body = randomBytes(i % 64);
    const secret = randomBytes(16).toString("hex");
    assert.equal(verifySignature(secret, body, sign(secret, body)), true);
    assert.equal(verifySignature(secret + "x", body, sign(secret, body)), false);
  }
});

test("PR URLs normalize to one form", () => {
  const canonical = "https://github.com/stratuslabs/agentboard/pull/98";
  for (const url of [
    canonical,
    "https://github.com/StratusLabs/AgentBoard/pull/98",
    "https://GITHUB.com/stratuslabs/agentboard/pull/98/",
    "https://github.com/stratuslabs/agentboard/pull/98/files",
    "https://github.com/stratuslabs/agentboard/pull/98/commits",
    "https://github.com/stratuslabs/agentboard/pull/98/commits/3a463f4",
    "https://github.com/stratuslabs/agentboard/pull/98/checks?x=1",
    "https://github.com/stratuslabs/agentboard/pull/98#discussion_r4430757016",
    "https://github.com/stratuslabs/agentboard/pull/98?w=1#top",
    "  https://github.com/stratuslabs/agentboard/pull/98  ",
    "http://github.com/stratuslabs/agentboard/pull/98",
    "https://www.github.com/stratuslabs/agentboard/pull/98",
  ]) {
    assert.equal(normalizePrUrl(url), canonical, url);
  }
});

test("what isn't a PR URL normalizes to null", () => {
  for (const url of [
    null,
    undefined,
    "",
    "not a url",
    "https://github.com/stratuslabs/agentboard/issues/98",
    "https://github.com/stratuslabs/agentboard/pull/",
    "https://github.com/stratuslabs/agentboard/pull/abc",
    "https://github.com/stratuslabs/agentboard/pull/0",
    "https://github.com/stratuslabs/pull/98",
    "https://example.com/stratuslabs/agentboard/pull/98",
    "https://github.com.evil.example/stratuslabs/agentboard/pull/98",
    "ftp://github.com/stratuslabs/agentboard/pull/98",
    "javascript:alert(1)//github.com/a/b/pull/1",
  ]) {
    assert.equal(normalizePrUrl(url), null, String(url));
  }
});

test("normalizing is idempotent and case-blind on random owners and repos", () => {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_.";
  const word = () =>
    "a" + Array.from({ length: 1 + (randomBytes(1)[0] % 12) }, () => chars[randomBytes(1)[0] % chars.length]).join("");
  for (let i = 0; i < 300; i++) {
    const n = 1 + (randomBytes(2).readUInt16BE() % 5000);
    const url = `https://github.com/${word()}/${word()}/pull/${n}`;
    const once = normalizePrUrl(url);
    assert.ok(once, url);
    assert.equal(normalizePrUrl(once), once);
    assert.equal(normalizePrUrl(url.toUpperCase().replace("HTTPS://", "https://").replace("/PULL/", "/pull/")), once);
    assert.equal(normalizePrUrl(url + "/files#x"), once);
  }
});

test("card references in a PR body: this instance's links only", () => {
  const origin = "https://app.agentboard.to";
  const body = [
    "Moves cards when PRs merge.",
    "",
    "Card: https://app.agentboard.to/c/1000",
    "Also https://app.agentboard.to/c/AB-142.",
    "Board link: https://app.agentboard.to/stratus/agentboard/development?card=834&x=1",
    "Markdown [card](https://app.agentboard.to/c/98)",
    "Again https://app.agentboard.to/c/1000 (dup)",
    "Elsewhere: https://other.example/c/5 and https://app.agentboard.to.evil.example/c/6",
    "Not a card: https://app.agentboard.to/c/ and https://app.agentboard.to/cards/7",
    "Nor: https://app.agentboard.to/c/12_draft https://app.agentboard.to/c/13/x https://app.agentboard.to:8443/c/14",
    "Nor: https://app.agentboard.to.evil.example/b?card=15 https://app.agentboard.to-x.example/c/16",
    "Closes #12",
  ].join("\n");
  assert.deepEqual(cardRefsInBody(body, origin), ["1000", "AB-142", "834", "98"]);
  assert.deepEqual(cardRefsInBody("", origin), []);
  assert.deepEqual(cardRefsInBody(null, origin), []);
  assert.deepEqual(cardRefsInBody(body, ""), []);
  // A trailing slash on the origin doesn't matter, and the host is case-blind.
  assert.deepEqual(cardRefsInBody("HTTPS://App.AgentBoard.to/c/3", origin + "/"), ["3"]);
});

test("the History line says what happened", () => {
  const date = new Date("2026-10-31T12:00:00Z");
  const pr = { repo: "stratuslabs/agentboard", number: 98, url: "https://github.com/stratuslabs/agentboard/pull/98" };
  assert.equal(
    closeHistoryLine({ ...pr, outcome: "merged", date }),
    "- Oct 31: PR stratuslabs/agentboard#98 merged; moved to Done (GitHub App) https://github.com/stratuslabs/agentboard/pull/98"
  );
  assert.equal(
    closeHistoryLine({ ...pr, outcome: "closed", date }),
    "- Oct 31: PR stratuslabs/agentboard#98 closed without merging (GitHub App) https://github.com/stratuslabs/agentboard/pull/98"
  );
  assert.equal(
    closeHistoryLine({ ...pr, outcome: "no-done-column", date }),
    "- Oct 31: PR stratuslabs/agentboard#98 merged, but this board has no Done column (GitHub App) https://github.com/stratuslabs/agentboard/pull/98"
  );
});

test("a History line goes at the end of the History section", () => {
  const line = "- Oct 31: PR a/b#1 merged; moved to Done (GitHub App) https://github.com/a/b/pull/1";
  const card = [
    "What it is.",
    "",
    "**Status:** In Review.",
    "",
    "**History:**",
    "- Oct 30: PR opened",
  ].join("\n");
  assert.equal(appendHistory(card, line), card + "\n" + line);

  // A section after History stays after it.
  const withAfter = card + "\n\n**Notes:**\nkeep me";
  assert.equal(
    appendHistory(withAfter, line),
    card + "\n" + line + "\n\n**Notes:**\nkeep me"
  );

  // No History section: one is added.
  assert.equal(appendHistory("Just text.", line), "Just text.\n\n**History:**\n" + line);
  assert.equal(appendHistory("", line), "**History:**\n" + line);
  assert.equal(appendHistory(null, line), "**History:**\n" + line);

  // An empty History section.
  assert.equal(appendHistory("**History:**\n", line), "**History:**\n" + line);
  // Heading spelled without bold, or as a Markdown heading.
  assert.equal(appendHistory("History:\n- a", line), "History:\n- a\n" + line);
  assert.equal(appendHistory("## History\n- a\n\n## Next\nb", line), "## History\n- a\n" + line + "\n\n## Next\nb");
});
