import { NextRequest, NextResponse } from "next/server";
import { sql } from "@vercel/postgres";

export async function GET(request: NextRequest) {
  const productId = request.nextUrl.searchParams.get("product_id");

  if (!productId) {
    return NextResponse.json({ error: "product_id is required" }, { status: 400 });
  }

  const { rows } = await sql`SELECT * FROM boards WHERE product_id = ${productId} ORDER BY position`;
  return NextResponse.json(rows);
}
