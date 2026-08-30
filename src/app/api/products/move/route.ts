import { initDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/sql";

export async function PATCH(request: NextRequest) {
  await initDb();
  const { product_id, org_id, position } = await request.json();

  if (!product_id || !org_id) {
    return NextResponse.json({ error: "product_id and org_id required" }, { status: 400 });
  }

  const pos = position ?? 0;
  const { rows } = await sql`
    UPDATE products SET org_id = ${org_id}, position = ${pos} WHERE id = ${product_id} RETURNING *
  `;

  if (rows.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(rows[0]);
}
