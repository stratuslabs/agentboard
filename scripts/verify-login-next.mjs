#!/usr/bin/env node
//
// Signing in returns you to the page you asked for.
//
// Against a running app with APP_PASSWORD set, checks that a signed-out page
// load redirects to /login?next=<that page>, that home, API routes and form
// posts don't carry one, and that the session from /api/auth/login then opens
// the page. Following ?next= happens in the browser (src/app/login/page.tsx,
// through lib/login-next), so this checks what the server hands it; the rules
// for which values are followed are in test/login-next.test.mjs. Writes
// nothing to the database.
//
//   BASE_URL=http://localhost:3000 APP_PASSWORD=... node scripts/verify-login-next.mjs

const BASE = process.env.BASE_URL || "http://localhost:3000";
const PASSWORD = process.env.APP_PASSWORD || "";

let passed = 0;
let failed = 0;

function check(name, condition, detail = "") {
  if (condition) {
    passed++;
    console.log(`  ok   ${name}`);
  } else {
    failed++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

/** A request that does not follow redirects, so the redirect itself can be checked. */
function raw(method, path, headers = {}) {
  return fetch(`${BASE}${path}`, { method, headers, redirect: "manual" });
}

async function expectLogin(label, method, path, expectedNext) {
  const res = await raw(method, path, method === "GET" ? {} : { Origin: new URL(BASE).origin });
  check(`${label}: redirects`, res.status === 307 || res.status === 308, `got ${res.status}`);
  const location = res.headers.get("location");
  const url = location ? new URL(location, BASE) : null;
  check(`${label}: to /login`, url?.pathname === "/login", `got ${location}`);
  check(
    `${label}: ${expectedNext === null ? "with no ?next=" : `with ?next=${expectedNext}`}`,
    url?.searchParams.get("next") === expectedNext,
    `got ${location}`
  );
}

async function main() {
  if (!PASSWORD) {
    console.error("Set APP_PASSWORD to the running app's password: with none, nothing is signed out.");
    process.exit(1);
  }
  console.log(`Verifying the login destination against ${BASE}`);

  console.log("\nSigned-out page loads keep the destination");
  await expectLogin("card link", "GET", "/c/609", "/c/609");
  await expectLogin("card key link", "GET", "/c/AB-142", "/c/AB-142");
  await expectLogin("board with query", "GET", "/labs/agentboard?board=development&card=609", "/labs/agentboard?board=development&card=609");
  await expectLogin("settings", "GET", "/settings", "/settings");

  console.log("\nNothing to carry");
  await expectLogin("home", "GET", "/", null);
  await expectLogin("form post", "POST", "/labs/agentboard", null);

  const api = await raw("GET", "/api/orgs");
  check("API route: JSON 401, not a redirect", api.status === 401 && !api.headers.get("location"), `got ${api.status}`);

  const login = await raw("GET", `/login?next=${encodeURIComponent("https://evil.test/")}`);
  check("login page with a foreign ?next= still loads", login.status === 200, `got ${login.status}`);

  console.log("\nSigned in");
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: new URL(BASE).origin },
    body: JSON.stringify({ password: PASSWORD }),
  });
  check("password accepted", res.ok, `got ${res.status}`);
  const cookie = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  check("session cookie set", cookie.length > 0);

  const after = await raw("GET", "/settings", { Cookie: cookie });
  check("the destination opens with the session", after.status === 200, `got ${after.status} ${after.headers.get("location") ?? ""}`);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
