// GitHub App install flow (card 1000), without a database or the network:
//
// - githubAppConfig: the integration is on only when all four env vars are set.
// - signState / readState: the `state` round-trips through GitHub signed, and
//   is refused when tampered with, expired, signed for another team, or
//   carried back to a browser that didn't start the flow (nonce cookie).
// - completeInstall: exchanges the code, then binds only an installation the
//   signed-in GitHub user can actually reach. That check is what stops someone
//   binding another account's installation id to their own board.

import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  githubAppConfig,
  installUrl,
  signState,
  readState,
  completeInstall,
  InstallError,
} from "../src/lib/github-install.js";

const ENV = {
  GITHUB_APP_SLUG: "agentboard-test",
  GITHUB_APP_CLIENT_ID: "Iv1.abc",
  GITHUB_APP_CLIENT_SECRET: "s3cret",
  GITHUB_APP_WEBHOOK_SECRET: "hook",
};
const SECRET = "s3cret";
const NOW = 1_800_000_000_000;

test("githubAppConfig needs all four variables", () => {
  assert.deepEqual(githubAppConfig(ENV), {
    slug: "agentboard-test",
    clientId: "Iv1.abc",
    clientSecret: "s3cret",
    webhookSecret: "hook",
  });
  for (const key of Object.keys(ENV)) {
    assert.equal(githubAppConfig({ ...ENV, [key]: "" }), null, `${key} empty`);
    assert.equal(githubAppConfig({ ...ENV, [key]: "  " }), null, `${key} blank`);
    const missing = { ...ENV };
    delete missing[key];
    assert.equal(githubAppConfig(missing), null, `${key} missing`);
  }
});

test("installUrl points at the App's install page with the state", () => {
  const url = new URL(installUrl("agentboard-test", "a.b"));
  assert.equal(url.origin + url.pathname, "https://github.com/apps/agentboard-test/installations/new");
  assert.equal(url.searchParams.get("state"), "a.b");
  assert.throws(() => installUrl("../evil", "x"));
});

test("state round-trips for the same team and nonce", () => {
  for (let i = 0; i < 200; i++) {
    const teamId = 1 + Math.floor(Math.random() * 2 ** 31 - 2);
    const nonce = randomBytes(16).toString("base64url");
    const state = signState({ teamId, nonce, now: NOW }, SECRET);
    assert.deepEqual(readState(state, SECRET, { teamId, nonce, now: NOW + 1000 }), { teamId });
  }
});

test("state is refused for another team, nonce, secret, or after ten minutes", () => {
  const state = signState({ teamId: 7, nonce: "n1", now: NOW }, SECRET);
  assert.equal(readState(state, SECRET, { teamId: 8, nonce: "n1", now: NOW }), null, "other team");
  assert.equal(readState(state, SECRET, { teamId: 7, nonce: "n2", now: NOW }), null, "other browser");
  assert.equal(readState(state, SECRET, { teamId: 7, nonce: undefined, now: NOW }), null, "no cookie");
  assert.equal(readState(state, "other", { teamId: 7, nonce: "n1", now: NOW }), null, "other secret");
  assert.ok(readState(state, SECRET, { teamId: 7, nonce: "n1", now: NOW + 9 * 60_000 }), "within ten minutes");
  assert.equal(readState(state, SECRET, { teamId: 7, nonce: "n1", now: NOW + 11 * 60_000 }), null, "expired");
});

test("a tampered or malformed state never verifies", () => {
  const state = signState({ teamId: 7, nonce: "n1", now: NOW }, SECRET);
  const [body, mac] = state.split(".");
  const forged = Buffer.from(JSON.stringify({ t: 8, n: "n1", e: NOW + 600_000 })).toString("base64url");
  const bad = [
    `${forged}.${mac}`,
    `${body}.${mac.slice(0, -2)}AA`,
    `${body}.`,
    body,
    "",
    null,
    undefined,
    "a.b.c",
    `${Buffer.from("not json").toString("base64url")}.${mac}`,
  ];
  for (const s of bad) {
    assert.equal(readState(s, SECRET, { teamId: 7, nonce: "n1", now: NOW }), null, String(s));
    assert.equal(readState(s, SECRET, { teamId: 8, nonce: "n1", now: NOW }), null, String(s));
  }
  // Random junk never throws.
  for (let i = 0; i < 300; i++) {
    const junk = randomBytes(1 + (i % 60)).toString(i % 2 ? "base64url" : "latin1");
    assert.equal(readState(junk, SECRET, { teamId: 7, nonce: "n1", now: NOW }), null);
  }
});

const CONFIG = githubAppConfig(ENV);

/** A fake GitHub: one OAuth code, and the installations its user can see, in pages. */
function fakeGithub({ code = "good", token = "gho_x", installations = [], tokenError = null, tokenStatus = 200, apiStatus = 200 } = {}) {
  const calls = [];
  const fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    if (url.href === "https://github.com/login/oauth/access_token") {
      assert.equal(init.method, "POST");
      const body = JSON.parse(init.body);
      assert.equal(body.client_id, CONFIG.clientId);
      assert.equal(body.client_secret, CONFIG.clientSecret);
      // An unknown client ID: GitHub answers 404 {"error":"Not Found"} (seen Oct 31).
      if (tokenStatus !== 200) return Response.json({ error: "Not Found" }, { status: tokenStatus });
      if (tokenError) return Response.json({ error: tokenError, error_description: "nope" });
      if (body.code !== code) return Response.json({ error: "bad_verification_code" });
      return Response.json({ access_token: token, token_type: "bearer" });
    }
    if (url.origin + url.pathname === "https://api.github.com/user/installations") {
      assert.equal(init.headers.Authorization, `Bearer ${token}`);
      if (apiStatus !== 200) return new Response("{}", { status: apiStatus });
      const perPage = Number(url.searchParams.get("per_page"));
      const page = Number(url.searchParams.get("page") || 1);
      const slice = installations.slice((page - 1) * perPage, page * perPage);
      return Response.json({ total_count: installations.length, installations: slice });
    }
    throw new Error(`unexpected ${url}`);
  };
  return { fetch, calls };
}

const inst = (id, login) => ({ id, account: { login } });

test("completeInstall returns the account when the user can reach the installation", async () => {
  const gh = fakeGithub({ installations: [inst(11, "someone-else"), inst(42, "stratuslabs")] });
  assert.deepEqual(await completeInstall({ code: "good", installationId: "42", config: CONFIG, fetch: gh.fetch }), {
    installationId: 42,
    accountLogin: "stratuslabs",
  });
});

test("completeInstall finds an installation past the first page", async () => {
  const many = Array.from({ length: 230 }, (_, i) => inst(1000 + i, `acct${i}`));
  const gh = fakeGithub({ installations: many });
  const out = await completeInstall({ code: "good", installationId: 1225, config: CONFIG, fetch: gh.fetch });
  assert.deepEqual(out, { installationId: 1225, accountLogin: "acct225" });
  assert.equal(gh.calls.filter((c) => c.url.hostname === "api.github.com").length, 3);
});

test("completeInstall refuses an installation the user can't reach", async () => {
  const gh = fakeGithub({ installations: [inst(11, "mine")] });
  await assert.rejects(
    completeInstall({ code: "good", installationId: 42, config: CONFIG, fetch: gh.fetch }),
    (e) => e instanceof InstallError && e.status === 403
  );
  // An empty page ends the search instead of looping.
  const none = fakeGithub({ installations: [] });
  await assert.rejects(
    completeInstall({ code: "good", installationId: 42, config: CONFIG, fetch: none.fetch }),
    (e) => e instanceof InstallError && e.status === 403
  );
  assert.equal(none.calls.filter((c) => c.url.hostname === "api.github.com").length, 1);
});

test("completeInstall rejects bad input and GitHub failures with a status", async () => {
  const gh = fakeGithub({ installations: [inst(42, "x")] });
  const cases = [
    [{ code: "", installationId: 42 }, 400],
    [{ code: "good", installationId: "" }, 400],
    [{ code: "good", installationId: "42abc" }, 400],
    [{ code: "good", installationId: "-1" }, 400],
    [{ code: "stale", installationId: 42 }, 400],
  ];
  for (const [args, status] of cases) {
    await assert.rejects(
      completeInstall({ ...args, config: CONFIG, fetch: gh.fetch }),
      (e) => e instanceof InstallError && e.status === status,
      JSON.stringify(args)
    );
  }
  await assert.rejects(
    completeInstall({ code: "good", installationId: 42, config: CONFIG, fetch: fakeGithub({ apiStatus: 500 }).fetch }),
    (e) => e instanceof InstallError && e.status === 502
  );
  const down = async () => {
    throw new TypeError("fetch failed");
  };
  await assert.rejects(
    completeInstall({ code: "good", installationId: 42, config: CONFIG, fetch: down }),
    (e) => e instanceof InstallError && e.status === 502
  );
});

test("a misconfigured App points at the server's settings, not at the user", async () => {
  const configError = (e) =>
    e instanceof InstallError && e.status === 502 && /GITHUB_APP_CLIENT_ID/.test(e.message) && !/try again/i.test(e.message);
  await assert.rejects(
    completeInstall({ code: "good", installationId: 42, config: CONFIG, fetch: fakeGithub({ tokenStatus: 404 }).fetch }),
    configError
  );
  await assert.rejects(
    completeInstall({
      code: "good",
      installationId: 42,
      config: CONFIG,
      fetch: fakeGithub({ tokenError: "incorrect_client_credentials" }).fetch,
    }),
    configError
  );
});
