// After signing in, the login page sends you back to the page you asked for.
// The middleware puts that page in /login?next=<path>, and the login page only
// follows it when it is a path on this site. Anything else, including a link
// someone crafted to bounce a fresh session to their own domain, goes home.
//
//   node --test test/

import { test } from "node:test";
import assert from "node:assert/strict";
import { loginPath, safeNextPath } from "../src/lib/login-next.js";

test("a same-site path comes back as written, query included", () => {
  for (const path of [
    "/c/609",
    "/c/AB-142",
    "/labs/agentboard",
    "/labs/agentboard?card=609",
    "/labs/agentboard?board=development&card=609",
    "/settings",
    "/today",
    "/labs/agent%20board",
  ]) {
    assert.equal(safeNextPath(path), path);
  }
});

test("a missing or empty value goes home", () => {
  for (const value of [undefined, null, "", "   ", 42, {}, ["/c/1"]]) {
    assert.equal(safeNextPath(value), "/");
  }
});

test("anything that leaves the site goes home, so ?next= is not an open redirect", () => {
  for (const value of [
    "https://evil.test/",
    "http://evil.test/c/1",
    "//evil.test",
    "//evil.test/c/1",
    "///evil.test",
    "/\\evil.test",
    "\\\\evil.test",
    "/\t/evil.test",
    "/\n/evil.test",
    " //evil.test",
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "data:text/html,hi",
    "evil.test",
    "c/609",
    // Dot segments that collapse into a protocol-relative path once resolved.
    "/.//evil.test",
    "/x/..//evil.test",
    "/%2e//evil.test",
  ]) {
    const got = safeNextPath(value);
    assert.equal(got, "/", `${JSON.stringify(value)} should go home, got ${got}`);
  }
});

test("the result never starts with two slashes or a backslash", () => {
  const tricky = ["/", "/.", "/..", "/./", "/a/../", "/%2F%2Fevil.test", "/%5Cevil.test", "/a//b"];
  for (const value of tricky) {
    const got = safeNextPath(value);
    assert.ok(got.startsWith("/"), `${value} -> ${got}`);
    assert.ok(!got.startsWith("//"), `${value} -> ${got}`);
    assert.ok(!got.startsWith("/\\"), `${value} -> ${got}`);
  }
  // Encoded slashes stay encoded: the browser treats them as one path segment.
  assert.equal(safeNextPath("/%2F%2Fevil.test"), "/%2F%2Fevil.test");
});

test("login and API paths go home instead of looping or landing on JSON", () => {
  for (const value of ["/login", "/login?next=/c/1", "/api", "/api/tasks", "/api/auth/login"]) {
    assert.equal(safeNextPath(value), "/", value);
  }
});

test("a fragment is dropped (the server never sees one anyway)", () => {
  assert.equal(safeNextPath("/c/609#history"), "/c/609");
});

test("loginPath carries the page through ?next=, and leaves plain /login for home", () => {
  assert.equal(loginPath("/c/609", ""), "/login?next=%2Fc%2F609");
  assert.equal(loginPath("/labs/agentboard", "?card=609"), "/login?next=%2Flabs%2Fagentboard%3Fcard%3D609");
  assert.equal(loginPath("/", ""), "/login");
  assert.equal(loginPath("/login", ""), "/login");
  assert.equal(loginPath("//evil.test", ""), "/login");
});

test("what loginPath writes, safeNextPath reads back to the same page", () => {
  for (const [pathname, search] of [
    ["/c/609", ""],
    ["/labs/agentboard", "?board=development&card=609"],
    ["/labs/agent%20board", "?q=a%26b"],
  ]) {
    const next = new URL(loginPath(pathname, search), "http://board.test").searchParams.get("next");
    assert.equal(safeNextPath(next), pathname + search);
  }
});
