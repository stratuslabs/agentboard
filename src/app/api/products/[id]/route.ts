import { NextRequest, NextResponse } from "next/server";
import { sql } from "@vercel/postgres";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const numId = parseInt(id, 10);

  let result;
  if (!isNaN(numId)) {
    result = await sql`DELETE FROM products WHERE id = ${numId} OR slug = ${id}`;
  } else {
    result = await sql`DELETE FROM products WHERE slug = ${id}`;
  }

  if (result.rowCount === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}
