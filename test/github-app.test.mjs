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
  readBodyLimited,
  WEBHOOK_MAX_BYTES,
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

test("a board link copied from the address bar names the card by key", () => {
  const origin = "https://app.agentboard.to";
  const body = [
    "Board link: https://app.agentboard.to/labs/agentboard?card=AB-106",
    "Full page: https://app.agentboard.to/labs/agentboard?board=61&card=okb-20&view=full",
    "Old style: https://app.agentboard.to/labs/agentboard?card=1344",
    "Not a card: https://app.agentboard.to/labs/agentboard?card=AB-",
    "Nor: https://app.agentboard.to/labs/agentboard?card=AB-12x https://app.agentboard.to/labs/agentboard?card=A-1",
    "Elsewhere: https://other.example/labs/agentboard?card=AB-9",
  ].join("\n");
  assert.deepEqual(cardRefsInBody(body, origin), ["AB-106", "okb-20", "1344"]);
});

test("a card reference ends where its URL value ends, not at the first punctuation", () => {
  const origin = "https://app.agentboard.to";
  const board = "https://app.agentboard.to/labs/agentboard";
  // The app reads the whole value (?card=AB-12-old, /c/AB-12.5) and rejects it,
  // so the webhook must not link the AB-12 prefix and move that card to Done.
  const malformed = [
    `${board}?card=AB-12-old`,
    `${board}?card=AB-12/x`,
    `${board}?card=AB-12.5`,
    `${board}?card=AB-12,x`,
    `${board}?card=AB-12%2F`,
    `${board}?card=12-old`,
    `${board}?card=12.5`,
    `${board}?x=1&card=12_draft`,
    `${origin}/c/AB-12.5`,
    `${origin}/c/12.5`,
    `${origin}/c/AB-12,x`,
    `${origin}/c/12%2F`,
  ];
  for (const text of malformed) {
    assert.deepEqual(cardRefsInBody(`See ${text} here`, origin), [], text);
    assert.deepEqual(cardRefsInBody(text, origin), [], text);
  }

  // Prose and Markdown around a well-formed link still end it.
  const body = [
    `Sentence end ${board}?card=AB-1.`,
    `List ${board}?card=AB-2, then more`,
    `Markdown [card](${board}?card=AB-3)`,
    `Angle <${board}?card=AB-4>`,
    `Fragment ${board}?card=AB-5#top`,
    `More params ${board}?card=AB-6&view=full`,
    `Bold **${board}?card=AB-7**`,
    `Quoted "${board}?card=8"`,
    `Excited ${board}?card=9!`,
    `Permalink ${origin}/c/AB-10?view=full and ${origin}/c/11#x`,
    `Trailing slash ${origin}/c/AB-12/ and colon ${origin}/c/13: done`,
    `Last ${board}?card=AB-14`,
  ].join("\n");
  assert.deepEqual(cardRefsInBody(body, origin), [
    "AB-1", "AB-2", "AB-3", "AB-4", "AB-5", "AB-6", "AB-7", "8", "9", "AB-10", "11", "AB-12", "13", "AB-14",
  ]);
});

test("a board link names the card the app would open: the first card parameter", () => {
  const origin = "https://app.agentboard.to";
  const board = "https://app.agentboard.to/labs/agentboard";
  // URLSearchParams.get("card") is what the board reads, so AB-2 here, not AB-1.
  assert.deepEqual(cardRefsInBody(`${board}?card=AB-2&card=AB-1`, origin), ["AB-2"]);
  assert.deepEqual(cardRefsInBody(`${board}?view=full&card=AB-3&x=1&card=AB-1`, origin), ["AB-3"]);
  // A first value the app rejects opens nothing, so nothing links.
  assert.deepEqual(cardRefsInBody(`${board}?card=AB-2-old&card=AB-1`, origin), []);
  assert.deepEqual(cardRefsInBody(`${board}?card=&card=AB-1`, origin), []);
  // Encoded values are read decoded, as the app reads them.
  assert.deepEqual(cardRefsInBody(`${board}?card=AB%2D4`, origin), ["AB-4"]);
  assert.deepEqual(cardRefsInBody(`${origin}/c/AB%2D5`, origin), ["AB-5"]);
  // A permalink is the path; a ?card= on it doesn't change which card it opens.
  assert.deepEqual(cardRefsInBody(`${origin}/c/AB-6?card=AB-1`, origin), ["AB-6"]);
  // Credentials in the URL are not this instance's links.
  assert.deepEqual(cardRefsInBody("https://someone@app.agentboard.to/c/7", origin), []);
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

const post = (body, headers = {}) =>
  new Request("http://localhost/api/integrations/github/webhook", { method: "POST", body, headers, duplex: "half" });

test("a webhook body within the limit is read byte for byte", async () => {
  const bytes = randomBytes(4096);
  const out = await readBodyLimited(post(bytes), 8192);
  assert.ok(Buffer.isBuffer(out));
  assert.ok(out.equals(bytes));
  assert.equal((await readBodyLimited(post(Buffer.alloc(8192)), 8192)).length, 8192, "exactly the limit is fine");
  assert.equal((await readBodyLimited(post(null), 8192)).length, 0, "no body reads as empty");
});

test("a declared Content-Length over the limit is refused without reading the body", async () => {
  let pulled = 0;
  const stream = new ReadableStream({
    pull(controller) {
      pulled++;
      controller.enqueue(new Uint8Array(1024));
    },
  });
  const out = await readBodyLimited(post(stream, { "content-length": String(10 * 1024 * 1024) }), 8192);
  assert.equal(out, null);
  assert.ok(pulled <= 1, `read ${pulled} chunks of a body it should have refused`);
});

test("a body that streams past the limit is cut off, whatever it declared", async () => {
  // Never ends on its own: only the limit stops the read.
  let pulled = 0;
  let cancelled = false;
  const endless = new ReadableStream({
    pull(controller) {
      pulled++;
      controller.enqueue(new Uint8Array(1000));
    },
    cancel() {
      cancelled = true;
    },
  });
  const out = await readBodyLimited(post(endless), 8192);
  assert.equal(out, null);
  assert.ok(pulled <= 10, `kept reading: ${pulled} chunks`);
  assert.ok(cancelled, "the stream is cancelled");
});

test("the webhook limit fits GitHub's largest pull_request payloads", () => {
  // A PR body is at most 65,536 characters; JSON-escaped at 6 bytes each that
  // is under 400 KB, plus the rest of the payload.
  assert.ok(WEBHOOK_MAX_BYTES >= 1024 * 1024);
  assert.ok(WEBHOOK_MAX_BYTES <= 25 * 1024 * 1024, "no more than GitHub itself sends");
});
