import { initDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@vercel/postgres";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await initDb();
  const { id } = await params;
  const body = await request.json();

  const { rows: existing } = await sql`SELECT * FROM members WHERE id = ${id}`;
  if (existing.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const updates: Record<string, unknown> = {};
  if (body.name !== undefined) updates.name = body.name;
  if (body.type !== undefined) updates.type = body.type;
  if (body.color !== undefined) updates.color = body.color;
  if (body.avatar_url !== undefined) updates.avatar_url = body.avatar_url;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json(existing[0]);
  }

  const member = existing[0];
  const { rows } = await sql`
    UPDATE members SET
      name = ${(updates.name as string) ?? member.name},
      type = ${(updates.type as string) ?? member.type},
      color = ${(updates.color as string) ?? member.color},
      avatar_url = ${(updates.avatar_url as string) ?? member.avatar_url}
    WHERE id = ${id}
    RETURNING *
  `;
  return NextResponse.json(rows[0]);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await initDb();
  const { id } = await params;
  const result = await sql`DELETE FROM members WHERE id = ${id}`;
  if (result.rowCount === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}
