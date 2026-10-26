import { initDb } from "../../../../lib/db";
import { isUniqueViolation, planSlugName } from "../../../../lib/slug";
import { NextRequest, NextResponse } from "next/server";
import { sql } from "../../../../lib/sql";
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

  // The slug stays: URLs and agent configs point at it. The new name still
  // can't be one another board in the product has, or makes.
  const { rows: siblings } = await sql`
    SELECT id, name, slug FROM boards WHERE product_id = (SELECT product_id FROM boards WHERE id = ${id})
  `;
  const plan = planSlugName({ kind: "board", scope: "in this product" }, body.name, siblings, id);
  if (!plan.ok) return NextResponse.json({ error: plan.error }, { status: plan.status });

  let rows;
  try {
    ({ rows } = await sql`
      UPDATE boards SET name = ${plan.name}, slug = ${plan.slug}, updated_at = NOW() WHERE id = ${id} RETURNING *
    `);
  } catch (err) {
    if (isUniqueViolation(err)) {
      return NextResponse.json({ error: "Another board in this product already uses that slug. Pick a different name." }, { status: 409 });
    }
    throw err;
  }
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
