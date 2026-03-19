import { NextRequest, NextResponse } from "next/server";
import { sql } from "@vercel/postgres";
import { initDb, slugify, createDefaultBoards } from "@/lib/db";

export async function GET(request: NextRequest) {
  await initDb();
  const orgId = request.nextUrl.searchParams.get("org_id");

  let rows;
  if (orgId) {
    ({ rows } = await sql`SELECT * FROM products WHERE org_id = ${orgId} ORDER BY position, name`);
  } else {
    ({ rows } = await sql`SELECT * FROM products ORDER BY position, name`);
  }
  return NextResponse.json(rows);
}

export async function POST(request: NextRequest) {
  await initDb();
  const { org_id, name, emoji } = await request.json();
  if (!org_id || !name) {
    return NextResponse.json({ error: "org_id and name are required" }, { status: 400 });
  }

  const slug = slugify(name);
  const { rows: maxRows } = await sql`SELECT COALESCE(MAX(position), -1) as max FROM products WHERE org_id = ${org_id}`;

  try {
    const { rows } = await sql`
      INSERT INTO products (org_id, name, slug, emoji, position)
      VALUES (${org_id}, ${name}, ${slug}, ${emoji || '📦'}, ${maxRows[0].max + 1})
      RETURNING *
    `;

    const productId = rows[0].id;
    await createDefaultBoards(productId);

    return NextResponse.json(rows[0], { status: 201 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    if (msg.includes("unique") || msg.includes("duplicate")) {
      return NextResponse.json({ error: "Product already exists in this org" }, { status: 409 });
    }
    throw e;
  }
}
