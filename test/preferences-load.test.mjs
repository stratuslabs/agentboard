// Signing in with a password asked people who already had a profile to set one
// up again, and Continue added a duplicate member (AB-152). The preferences
// provider lives in the root layout, so it first loads on /login, where the
// request fails (401). That failure was treated as "no profile saved", and the
// client-side navigation after sign-in never loaded preferences again.
//
// A load that didn't work is a failure, never empty preferences. The profile
// dialog opens only after a load that came from the server, and the provider
// asks again on the next page until one does.
//
//   node --test test/

import { test } from "node:test";
import assert from "node:assert/strict";
import { confirmedProfileMember, loadPreferences, needsProfileSetup } from "../src/lib/preferences-load.js";

const respond = (status, body) => async () =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

test("the server's preferences come back as loaded", async () => {
  const prefs = { "agentboard-profile-member-id": 372, "agentboard-starred-products": [4] };
  assert.deepEqual(await loadPreferences(respond(200, prefs)), { ok: true, prefs });
});

test("no saved preferences is a successful, empty load", async () => {
  assert.deepEqual(await loadPreferences(respond(200, {})), { ok: true, prefs: {} });
});

test("signed out, forbidden or a server error is a failure, not empty preferences", async () => {
  for (const status of [401, 403, 404, 500, 503]) {
    assert.deepEqual(await loadPreferences(respond(status, { error: "nope" })), { ok: false }, `status ${status}`);
  }
});

test("an answer that isn't a preferences object is a failure", async () => {
  for (const body of ["<!doctype html><title>Sign in</title>", "null", "[]", "42", '"x"']) {
    assert.deepEqual(await loadPreferences(respond(200, body)), { ok: false }, body);
  }
});

test("a dropped connection is a failure", async () => {
  const offline = async () => { throw new TypeError("Failed to fetch"); };
  assert.deepEqual(await loadPreferences(offline), { ok: false });
});

test("the request can be aborted", async () => {
  const request = new AbortController();
  let seen;
  const fetchImpl = async (_url, init) => { seen = init?.signal; throw new DOMException("aborted", "AbortError"); };
  request.abort();
  assert.deepEqual(await loadPreferences(fetchImpl, request.signal), { ok: false });
  assert.equal(seen, request.signal);
});

test("profile setup opens only when the server says there is no profile", () => {
  // Loaded from the server, no profile: a new user, ask.
  assert.equal(needsProfileSetup({ serverLoaded: true, profileMemberId: null }), true);
  // Loaded from the server, profile set: never ask.
  assert.equal(needsProfileSetup({ serverLoaded: true, profileMemberId: 372 }), false);
  // Still loading, or the load failed (signed out on /login, a 500, offline):
  // we don't know, and asking would create a duplicate member.
  assert.equal(needsProfileSetup({ serverLoaded: false, profileMemberId: null }), false);
  assert.equal(needsProfileSetup({ serverLoaded: false, profileMemberId: 372 }), false);
});

// "Me" on Assigned to me, Past Due and the Past Due badge is the profile the
// server confirms for this user and team. The local cache is shared by
// everyone who signs in on the browser and by every team, so trusting it
// showed the previous person's cards, or another team's member (AB-162).

test("the confirmed profile is the server's saved value", () => {
  assert.equal(confirmedProfileMember(372, false, 9), 372);
});

test("no saved profile on the server is no profile, whatever the cache holds", () => {
  assert.equal(confirmedProfileMember(undefined, false, 9), null);
  assert.equal(confirmedProfileMember(null, false, 9), null);
});

test("a saved value that isn't a member id is no profile", () => {
  for (const bad of ["dylan", 1.5, {}, [], true, 0, -3]) {
    assert.equal(confirmedProfileMember(bad, false, null), null, JSON.stringify(bad));
  }
});

test("a profile set in this session while the load was in flight wins", () => {
  assert.equal(confirmedProfileMember(372, true, 9), 9);
  assert.equal(confirmedProfileMember(undefined, true, 9), 9);
});
