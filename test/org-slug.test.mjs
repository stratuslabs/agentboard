// An organization lives at /<org-slug>/<product-slug>, so an org slug that
// matches one of the app's own top-level pages can't be reached. The core
// reserves its own pages; an app that consumes it adds pages of its own
// (sign-up, billing) and reserves those with configure({ reservedOrgSlugs }).
//
// Like configure.test.mjs, modules are loaded more than once to stand in for
// Next's separate bundles: the app configures in instrumentation, and the orgs
// route reads it from its own copy.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./support/ts-loader.mjs", import.meta.url);

let copies = 0;
async function fresh(path) {
  copies += 1;
  return import(new URL(`../src/${path}?copy=${copies}`, import.meta.url).href);
}

afterEach(async () => {
  (await fresh("configure.ts")).configure({});
});

test("the core's own pages are reserved, and nothing else by default", async () => {
  const slugs = await fresh("lib/org-slug.ts");
  assert.equal(slugs.isReservedOrgSlug("settings"), true);
  assert.equal(slugs.isReservedOrgSlug("API"), true);
  assert.equal(slugs.isReservedOrgSlug("billing"), false);
  assert.equal(slugs.orgSlugFromName("Billing"), "billing");
  assert.equal(slugs.orgSlugFromName("C"), "c-org");
});

test("an app's reserved slugs apply in another module copy", async () => {
  const { configure } = await fresh("configure.ts");
  const slugs = await fresh("lib/org-slug.ts");

  configure({ reservedOrgSlugs: ["billing", "signup"] });

  assert.equal(slugs.isReservedOrgSlug("billing"), true);
  assert.equal(slugs.isReservedOrgSlug("Signup"), true);
  assert.equal(slugs.orgSlugFromName("Billing"), "billing-org");
  // The core's own stay reserved alongside them.
  assert.equal(slugs.isReservedOrgSlug("settings"), true);
  assert.equal(slugs.isReservedOrgSlug("pricing"), false);
});

test("configuring again replaces the app's reserved slugs", async () => {
  const { configure } = await fresh("configure.ts");
  const slugs = await fresh("lib/org-slug.ts");

  configure({ reservedOrgSlugs: ["billing"] });
  configure({});

  assert.equal(slugs.isReservedOrgSlug("billing"), false);
});

test("reservedOrgSlugs must be a list of slugs", async () => {
  const { configure, getConfig } = await fresh("configure.ts");

  assert.throws(() => configure({ reservedOrgSlugs: "billing" }), /reservedOrgSlugs must be an array/);
  assert.throws(() => configure({ reservedOrgSlugs: ["Billing"] }), /not a slug: "Billing"/);
  assert.throws(() => configure({ reservedOrgSlugs: ["bill ing"] }), /not a slug/);
  assert.throws(() => configure({ reservedOrgSlugs: [""] }), /not a slug/);
  assert.throws(() => configure({ reservedOrgSlugs: [7] }), /not a slug/);

  // A rejected call leaves the previous configuration in force.
  configure({ reservedOrgSlugs: ["billing"] });
  assert.throws(() => configure({ reservedOrgSlugs: ["Nope"] }));
  assert.deepEqual([...getConfig().reservedOrgSlugs], ["billing"]);
});

test("the configured list can't be changed after configure()", async () => {
  const { configure, getConfig } = await fresh("configure.ts");
  const list = ["billing"];
  configure({ reservedOrgSlugs: list });
  list.push("signup");
  assert.deepEqual([...getConfig().reservedOrgSlugs], ["billing"]);
  assert.ok(Object.isFrozen(getConfig().reservedOrgSlugs));
});
