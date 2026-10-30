import { initDb } from "../../../../lib/db";
import { isUniqueViolation, planSlugName } from "../../../../lib/slug";
import { NextRequest, NextResponse } from "next/server";
import { sql, withClient } from "../../../../lib/sql";
import { withSiblingNames } from "../../../../lib/sibling-names";
import { notifyBoard } from "../../../../lib/realtime/notify";
import { assertBoard, withTenantParams } from "../../../../lib/tenant";

export const GET = withTenantParams<{ id: string }>(async (_request, { teamId }, { params }) => {
  await initDb();
  const id = await assertBoard(teamId, (await params).id);
  const { rows } = await sql`SELECT * FROM boards WHERE id = ${id}`;
  if (rows.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(rows[0]);
});

export const PATCH = withTenantParams<{ id: string }>(async (request: NextRequest, { teamId }, { params }) => {
  await initDb();
  const id = await assertBoard(teamId, (await params).id);
  const body = await request.json();
  if (!body.name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const { rows: owner } = await sql`SELECT product_id FROM boards WHERE id = ${id}`;
  if (owner.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // The slug stays: URLs and agent configs point at it. The new name still
  // can't be one another board in the product has, or makes. Checked and
  // written under the product's name lock (card 815).
  let result;
  try {
    result = await withClient((client) =>
      withSiblingNames(client, "board", owner[0].product_id, async (query) => {
        const { rows: siblings } = await query(
          "SELECT id, name, slug FROM boards WHERE product_id = $1", [owner[0].product_id]
        );
        const plan = planSlugName({ kind: "board", scope: "in this product" }, body.name, siblings, id);
        if (!plan.ok) return plan;
        const { rows } = await query(
          "UPDATE boards SET name = $1, slug = $2, updated_at = NOW() WHERE id = $3 RETURNING *", [plan.name, plan.slug, id]
        );
        return { ok: true as const, rows };
      })
    );
  } catch (err) {
    if (isUniqueViolation(err)) {
      return NextResponse.json({ error: "Another board in this product already uses that slug. Pick a different name." }, { status: 409 });
    }
    throw err;
  }
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  const { rows } = result;
  if (rows.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await notifyBoard(teamId, id);

  return NextResponse.json(rows[0]);
});

export const DELETE = withTenantParams<{ id: string }>(async (_request, { teamId }, { params }) => {
  await initDb();
  const id = await assertBoard(teamId, (await params).id);
  await sql`DELETE FROM boards WHERE id = ${id}`;
  // Announced after the fact so anyone still looking at it refetches and finds
  // it gone, rather than sitting on a board that no longer exists.
  await notifyBoard(teamId, id);
  return NextResponse.json({ ok: true });
});
