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

// The org name in a board's breadcrumb links to the org page, /<org-slug>. An
// org kept on a slug the core reserved before that slug was reserved (an
// existing `today` org keeps its URLs) has no org page: /today is the Today
// page, so its breadcrumb gets no link.
test("orgPageHref links an org's page, except on a core-reserved slug", async () => {
  const slugs = await fresh("lib/org-slug.ts");
  assert.equal(slugs.orgPageHref("northwind"), "/northwind");
  assert.equal(slugs.orgPageHref("today-org"), "/today-org");
  for (const reserved of ["today", "assigned", "past-due", "settings", "login", "api", "c", "Today"]) {
    assert.equal(slugs.orgPageHref(reserved), null, reserved);
  }
});

// AB-145: a card page's org crumb follows the board's rule. It links to
// /<org-slug> only when the server said the org has a page there (`org_page`),
// and never on a core-reserved slug.
test("orgCrumbHref links only when the org has a page", async () => {
  const slugs = await fresh("lib/org-slug.ts");
  assert.equal(slugs.orgCrumbHref("northwind", true), "/northwind");
  assert.equal(slugs.orgCrumbHref("northwind", false), null);
  assert.equal(slugs.orgCrumbHref("northwind", undefined), null);
  assert.equal(slugs.orgCrumbHref(undefined, true), null);
  assert.equal(slugs.orgCrumbHref("", true), null);
  assert.equal(slugs.orgCrumbHref("today", true), null);
});

// The cross-product views (Today, Assigned, Past due) say per card whether its
// org has a page, so a card page opened from one can link its org crumb.
test("withOrgPage adds org_page to cards that carry org_slug", async () => {
  const { configure } = await fresh("configure.ts");
  const slugs = await fresh("lib/org-slug.ts");

  configure({ orgPages: true, reservedOrgSlugs: ["billing"] });
  assert.deepEqual(
    slugs.withOrgPage([{ id: 1, org_slug: "northwind" }, { id: 2, org_slug: "billing" }, { id: 3, org_slug: "today" }]),
    [{ id: 1, org_slug: "northwind", org_page: true }, { id: 2, org_slug: "billing", org_page: false }, { id: 3, org_slug: "today", org_page: false }],
  );
  assert.deepEqual(slugs.withOrgPage({ id: 4, org_slug: "northwind" }), { id: 4, org_slug: "northwind", org_page: true });
  // Anything without an org slug passes through untouched.
  assert.deepEqual(slugs.withOrgPage([{ id: 5 }]), [{ id: 5 }]);
  assert.equal(slugs.withOrgPage(null), null);

  // An app that didn't mount the org page has none to link to.
  configure({ orgPages: false });
  assert.deepEqual(slugs.withOrgPage([{ id: 1, org_slug: "northwind" }]), [{ id: 1, org_slug: "northwind", org_page: false }]);
});
