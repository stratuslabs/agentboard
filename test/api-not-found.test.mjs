// An /api path no route claims answers with a JSON 404. Without the catch-all,
// Next falls through to the board page (`/api/tasks` reads as org "api",
// product "tasks") and sends the app's HTML with a 200, so a client that
// guessed a path, or wrote to one, is told it worked.
//
// This calls the handler directly. That Next actually routes unknown /api
// paths to it, ahead of the board page, is checked against a running server.

import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { readFileSync } from "node:fs";

register("./support/ts-loader.mjs", import.meta.url);

const route = await import("../src/app/api/[...path]/route.ts");
const { NextRequest } = await import("next/server.js");

for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
  test(`${method} on an unknown /api path is a JSON 404 naming the path`, async () => {
    assert.equal(typeof route[method], "function", `${method} is exported`);
    const request = new NextRequest("http://localhost/api/tasks?board=dev", {
      method,
      body: method === "GET" ? undefined : "{}",
    });
    const response = await route[method](request);
    assert.equal(response.status, 404);
    assert.match(response.headers.get("content-type") ?? "", /^application\/json/);
    const body = await response.json();
    assert.equal(body.error, `No API route for ${method} /api/tasks`);
  });
}

test("the catch-all is part of the package surface", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.exports["./app/api/[...path]/route"], "./src/app/api/[...path]/route.ts");
});
