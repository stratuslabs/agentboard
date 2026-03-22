import { NextRequest, NextResponse } from "next/server";
import { sql } from "@vercel/postgres";
import { initDb } from "@/lib/db";

export async function GET(request: NextRequest) {
  await initDb();
  const orgSlug = request.nextUrl.searchParams.get("org_slug");
  const productSlug = request.nextUrl.searchParams.get("product_slug");

  if (!orgSlug || !productSlug) {
    return NextResponse.json({ error: "org_slug and product_slug are required" }, { status: 400 });
  }

  const { rows } = await sql`
    SELECT p.*, o.name as org_name, o.slug as org_slug, o.id as org_id
    FROM products p
    JOIN organizations o ON o.id = p.org_id
    WHERE o.slug = ${orgSlug} AND p.slug = ${productSlug}
    LIMIT 1
  `;

  if (rows.length === 0) {
    return NextResponse.json({ error: "Product not found" }, { status: 404 });
  }

  return NextResponse.json(rows[0]);
}
