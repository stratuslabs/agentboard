// configure() is how a Next app that consumes the core (the hosted edition,
// test/consumer) swaps in its own tenant resolution.
//
// The consumer calls it once, typically from instrumentation.ts. Next compiles
// instrumentation and each route into separate bundles, each with its own copy
// of the core's modules, so the configuration has to live where every copy in
// the process sees it. These tests load the modules twice (distinct URLs make
// distinct module instances) to stand in for that.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./support/ts-loader.mjs", import.meta.url);

let copies = 0;
/** A fresh instance of a src module, as another bundle would have. */
async function fresh(path) {
  copies += 1;
  return import(new URL(`../src/${path}?copy=${copies}`, import.meta.url).href);
}

afterEach(async () => {
  (await fresh("configure.ts")).configure({});
});

const team = (teamId) => async () => ({ teamId, userId: null });

test("configure() in one module instance reaches another", async () => {
  const configuring = await fresh("configure.ts");
  const serving = await fresh("lib/tenant.ts");

  configuring.configure({ tenant: { fromRequest: team(7), fromPage: team(8) } });

  const resolver = serving.tenantResolver();
  assert.deepEqual(await resolver.fromRequest(new Request("http://x/")), { teamId: 7, userId: null });
  assert.deepEqual(await resolver.fromPage(), { teamId: 8, userId: null });
});

test("a partial tenant resolver keeps the self-hosted default for the rest", async () => {
  const { configure } = await fresh("configure.ts");
  const tenant = await fresh("lib/tenant.ts");
  const selfHostedPage = tenant.tenantResolver().fromPage;

  configure({ tenant: { fromRequest: team(3) } });

  const resolver = tenant.tenantResolver();
  assert.deepEqual(await resolver.fromRequest(new Request("http://x/")), { teamId: 3, userId: null });
  assert.equal(resolver.fromPage, selfHostedPage);
});

test("configure() replaces the previous configuration", async () => {
  const { configure } = await fresh("configure.ts");
  const tenant = await fresh("lib/tenant.ts");
  const selfHosted = tenant.tenantResolver().fromRequest;

  configure({ tenant: { fromRequest: team(1) } });
  configure({});

  assert.equal(tenant.tenantResolver().fromRequest, selfHosted);
});

test("setTenantResolver still works, through the same store", async () => {
  const tenant = await fresh("lib/tenant.ts");
  const other = await fresh("lib/tenant.ts");
  const selfHosted = other.tenantResolver().fromRequest;

  tenant.setTenantResolver({ fromRequest: team(5) });
  assert.deepEqual(await other.tenantResolver().fromRequest(new Request("http://x/")), { teamId: 5, userId: null });

  tenant.setTenantResolver(null);
  assert.equal(other.tenantResolver().fromRequest, selfHosted);
});

test("configure() rejects what it does not understand", async () => {
  const { configure } = await fresh("configure.ts");
  assert.throws(() => configure({ tennant: {} }), /Unknown configure\(\) option: tennant/);
  assert.throws(() => configure({ tenant: { fromRequest: "nope" } }), /tenant\.fromRequest must be a function/);
  assert.throws(() => configure({ tenant: { fromHeaders: () => {} } }), /Unknown tenant resolver: fromHeaders/);
});

test("a TenantError from another module instance is still a TenantError", async () => {
  // The consumer's resolver comes from its instrumentation bundle, so what it
  // throws is that copy's TenantError; withTenant in a route's copy must still
  // turn it into its status rather than a 500.
  const thrower = await fresh("lib/tenant.ts");
  const catcher = await fresh("lib/tenant.ts");
  const error = new thrower.TenantError(401, "Unauthorized");
  assert.ok(error instanceof catcher.TenantError);
  assert.ok(error instanceof Error);
  assert.equal(new Error("x") instanceof catcher.TenantError, false);
  assert.equal(Object.assign(new Error("x"), { status: 401 }) instanceof catcher.TenantError, false);
});

test("configure() takes a members.beforeTypeChange hook, and only that", async () => {
  const { configure, getConfig } = await fresh("configure.ts");
  const hook = async () => {};
  configure({ members: { beforeTypeChange: hook } });
  assert.equal(getConfig().members.beforeTypeChange, hook);
  assert.equal(getConfig().tenant, undefined);
  assert.throws(() => configure({ members: { beforeTypeChange: 1 } }), /members\.beforeTypeChange must be a function/);
  assert.throws(() => configure({ members: { afterTypeChange: hook } }), /Unknown members hook: afterTypeChange/);
  assert.throws(() => configure({ members: null }), /members must be an object/);
});
