// An /api path no route claims answers with a JSON 404. Without the catch-all,
// Next falls through to the board page (`/api/tasks` reads as org "api",
// product "tasks") and sends the app's HTML with a 200, so a client that
// guessed a path, or wrote to one, is told it worked.
//
// The response is built in lib/api-not-found, tested here without a database.
// The route wraps it in withTenant like every other handler, so a consumer's
// tenant resolver still turns an unauthenticated caller away first; that is in
// api-slug-params-db.test.mjs. That Next actually routes unknown /api paths to
// it, ahead of the board page, is checked against a running server.

import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { readFileSync } from "node:fs";

register("./support/ts-loader.mjs", import.meta.url);

const { apiNotFound } = await import("../src/lib/api-not-found.ts");
const { NextRequest } = await import("next/server.js");

for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
  test(`${method} on an unknown /api path is a JSON 404 naming the path`, async () => {
    const request = new NextRequest("http://localhost/api/tasks?board=dev", {
      method,
      body: method === "GET" ? undefined : "{}",
    });
    const response = apiNotFound(request);
    assert.equal(response.status, 404);
    assert.match(response.headers.get("content-type") ?? "", /^application\/json/);
    const body = await response.json();
    assert.equal(body.error, `No API route for ${method} /api/tasks`);
  });
}

test("the catch-all is part of the package surface, for every method, behind withTenant", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const source = readFileSync(new URL("../src/app/api/[[...path]]/route.ts", import.meta.url), "utf8");
  for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
    assert.match(source, /const notFound = withTenant\(/);
    assert.match(source, new RegExp(`export const ${method} = notFound;`), method);
  }
  assert.equal(pkg.exports["./app/api/[[...path]]/route"], "./src/app/api/[[...path]]/route.ts");
});

// The catch-all is optional so it also claims the bare /api root. A required
// [...path] needs one segment, so /api fell through to the org page's HTML.
test("the bare /api root is a JSON 404 too", async () => {
  const response = apiNotFound(new NextRequest("http://localhost/api"));
  assert.equal(response.status, 404);
  const body = await response.json();
  assert.equal(body.error, "No API route for GET /api");
});

// With a password set, the middleware answers an API caller with JSON and a
// page visitor with a redirect to /login. The bare /api root is an API path.
test("with a password set, an unauthenticated /api is a JSON 401, not a login redirect", async () => {
  const saved = process.env.APP_PASSWORD;
  process.env.APP_PASSWORD = "test-password";
  try {
    const { middleware } = await import("../src/middleware.ts");
    for (const path of ["/api", "/api/nope"]) {
      const response = await middleware(new NextRequest(`http://localhost${path}`));
      assert.equal(response.status, 401, path);
      assert.match(response.headers.get("content-type") ?? "", /^application\/json/, path);
    }
    const page = await middleware(new NextRequest("http://localhost/labs/general"));
    assert.equal(page.status, 307, "a page still redirects to /login");
  } finally {
    if (saved === undefined) delete process.env.APP_PASSWORD;
    else process.env.APP_PASSWORD = saved;
  }
});
