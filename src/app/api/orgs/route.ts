import { NextRequest, NextResponse } from "next/server";
import { sql } from "@vercel/postgres";
import { initDb, slugify } from "@/lib/db";

export async function GET() {
  await initDb();
  const { rows } = await sql`SELECT * FROM organizations ORDER BY position, name`;
  return NextResponse.json(rows);
}

export async function POST(request: NextRequest) {
  await initDb();
  const { name, slug: customSlug } = await request.json();
  if (!name) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  const slug = customSlug || slugify(name);
  const { rows: maxRows } = await sql`SELECT COALESCE(MAX(position), -1) as max FROM organizations`;

  try {
    const { rows } = await sql`
      INSERT INTO organizations (name, slug, position)
      VALUES (${name}, ${slug}, ${maxRows[0].max + 1})
      RETURNING *
    `;
    return NextResponse.json(rows[0], { status: 201 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    if (msg.includes("unique") || msg.includes("duplicate")) {
      return NextResponse.json({ error: "Organization already exists" }, { status: 409 });
    }
    throw e;
  }
}
