#!/usr/bin/env node
//
// Permanent card links: `/c/<id>` and the card lookup behind it.
//
// Creates its own organization and product, checks that `/c/<id>` sends the
// browser to the card's product with `?card=<id>` (the board page opens it
// from there, switching board tabs if it has to), and that anything that
// isn't a card is a 404 rather than a redirect or a server error. Removes the
// organization again; nothing else in the database is touched.
//
//   BASE_URL=http://localhost:3000 POSTGRES_URL=... node scripts/verify-card-links.mjs

import { sql, end } from "../src/lib/sql.js";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const TOKEN = process.env.APP_PASSWORD || "";

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

function section(title) {
  console.log(`\n${title}`);
}

function headers(extra) {
  const h = { "Content-Type": "application/json", ...extra };
  if (TOKEN) h.Authorization = `Bearer ${TOKEN}`;
  return h;
}

async function call(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: headers(),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // Not JSON; status is enough.
  }
  return { status: res.status, body: json };
}

/** A page request that does not follow redirects, so the redirect itself can be checked. */
function page(path) {
  return fetch(`${BASE}${path}`, { headers: headers(), redirect: "manual" });
}

async function expectRedirect(label, cardId, orgSlug, productSlug) {
  const res = await page(`/c/${cardId}`);
  check(`${label}: redirects`, res.status === 307 || res.status === 308, `got ${res.status}`);
  const location = res.headers.get("location");
  const url = location ? new URL(location, BASE) : null;
  check(`${label}: to the card's product`, url?.pathname === `/${orgSlug}/${productSlug}`, `got ${location}`);
  check(`${label}: with ?card=<id>`, url?.searchParams.get("card") === String(cardId), `got ${location}`);
}

async function main() {
  console.log(`Verifying card links against ${BASE}`);

  const org = await call("POST", "/api/orgs", { name: `Card Links Check ${Date.now()}` });
  if (org.status !== 201) {
    console.error(`Could not create an organization (${org.status}). Is the server running?`);
    process.exit(1);
  }
  const orgId = org.body.id;
  const extraOrgs = [];

  try {
    const product = await call("POST", "/api/products", { org_id: orgId, name: "Links Product" });
    const full = await call("GET", `/api/board?product_id=${product.body.id}`);
    const firstBoard = full.body.active_board_id;
    // Make the second board here rather than relying on the configured
    // default boards, which may be just one.
    const extra = await call("POST", "/api/boards", { product_id: product.body.id, name: "Links Other Board" });
    check("second board created", extra.status === 201 && extra.body?.id !== firstBoard, `got ${extra.status}`);
    const otherBoard = extra.body.id;
    const otherCols = await call("GET", `/api/columns?board_id=${otherBoard}`);

    const onFirst = await call("POST", "/api/cards", { column_id: full.body.columns[0].id, title: "On the first board" });
    const onOther = await call("POST", "/api/cards", { column_id: otherCols.body[0].id, title: "On another board" });

    section("/c/<id> finds the card");
    await expectRedirect("card on the default board", onFirst.body.id, org.body.slug, product.body.slug);
    await expectRedirect("card on another board", onOther.body.id, org.body.slug, product.body.slug);

    section("The link survives renames");
    const renamed = await call("PATCH", `/api/products/${product.body.id}`, { name: "Links Product Renamed" });
    check("product rename accepted", renamed.status === 200, `got ${renamed.status}`);
    await expectRedirect("after a product rename", onFirst.body.id, org.body.slug, renamed.body?.slug);

    section("Anything that isn't a card is a 404");
    await call("DELETE", `/api/cards/${onOther.body.id}`);
    for (const bad of [String(onOther.body.id), "abc", "0", "-1", "1.5", "12abc", "99999999999999999999"]) {
      const res = await page(`/c/${encodeURIComponent(bad)}`);
      check(`/c/${bad} is 404`, res.status === 404, `got ${res.status}`);
      check(`/c/${bad} does not redirect`, res.headers.get("location") === null);
    }

    section("The card lookup API rejects ids it can't match");
    for (const bad of ["abc", "12abc", "99999999999999999999"]) {
      const res = await call("GET", `/api/cards/${bad}`);
      check(`GET /api/cards/${bad} is 404, not 500`, res.status === 404, `got ${res.status}`);
    }
    const found = await call("GET", `/api/cards/${onFirst.body.id}`);
    check("GET /api/cards/<id> now carries org_slug", found.body?.org_slug === org.body.slug, `got ${found.body?.org_slug}`);

    section("Organization slugs can't shadow app routes like /c/<id>");
    for (const name of ["C", "Today", "Settings"]) {
      const reserved = name.toLowerCase();
      const made = await call("POST", "/api/orgs", { name: `${name}` });
      if (made.status === 201) extraOrgs.push(made.body.id);
      check(`org named "${name}" is created`, made.status === 201, `got ${made.status}`);
      check(`org named "${name}" does not get slug "${reserved}"`, made.body?.slug && made.body.slug !== reserved, `got ${made.body?.slug}`);
      if (name === "C" && made.status === 201) {
        const p = await call("POST", "/api/products", { org_id: made.body.id, name: "Shadow Check" });
        const res = await page(`/${made.body.slug}/${p.body?.slug}`);
        check(`org "C"'s product page loads at /${made.body.slug}/${p.body?.slug}`, res.status === 200, `got ${res.status}`);
      }
    }
    const custom = await call("POST", "/api/orgs", { name: `Custom C ${Date.now()}`, slug: "c" });
    if (custom.status === 201) extraOrgs.push(custom.body.id);
    check("explicit slug \"c\" is rejected with 400", custom.status === 400, `got ${custom.status}`);
    const renamedOrg = await call("PATCH", `/api/orgs/${orgId}`, { name: "Assigned" });
    check("rename to \"Assigned\" accepted", renamedOrg.status === 200, `got ${renamedOrg.status}`);
    check("rename to \"Assigned\" does not take slug \"assigned\"", renamedOrg.body?.slug && renamedOrg.body.slug !== "assigned", `got ${renamedOrg.body?.slug}`);
  } finally {
    for (const id of extraOrgs) await sql`DELETE FROM organizations WHERE id = ${id}`;
    // The organization cascades to products, boards, columns and cards.
    await sql`DELETE FROM organizations WHERE id = ${orgId}`;
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  await end();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error(err);
  await end().catch(() => {});
  process.exit(1);
});
