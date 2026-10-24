import { NextRequest, NextResponse } from "next/server";
import { sql, db } from "@/lib/sql";
import { initDb, slugify, createDefaultBoards } from "@/lib/db";
import { suggestEmoji } from "@/lib/emoji-suggest";
import { keyForNewProduct, isKeyConflict } from "@/lib/card-keys";

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
  const { org_id, name, emoji, key: requestedKey } = await request.json();
  if (!org_id || !name) {
    return NextResponse.json({ error: "org_id and name are required" }, { status: 400 });
  }
  // The prefix for its cards' readable ids (AB-142): the one asked for, or
  // one derived from the name.
  const key = await keyForNewProduct((text: string, values?: unknown[]) => db.query(text, values), name, requestedKey);
  if ("error" in key) {
    return NextResponse.json({ error: key.error }, { status: key.status });
  }

  const slug = slugify(name);
  const { rows: maxRows } = await sql`SELECT COALESCE(MAX(position), -1) as max FROM products WHERE org_id = ${org_id}`;

  try {
    const { rows } = await sql`
      INSERT INTO products (org_id, name, slug, emoji, position, key)
      VALUES (${org_id}, ${name}, ${slug}, ${emoji || suggestEmoji(name)}, ${maxRows[0].max + 1}, ${key.key})
      RETURNING *
    `;

    const productId = rows[0].id;
    await createDefaultBoards(productId);

    // Re-read: creating the boards set the product's default board.
    const { rows: created } = await sql`SELECT * FROM products WHERE id = ${productId}`;
    return NextResponse.json(created[0], { status: 201 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    // Checked above, but another request can take the key in between.
    if (isKeyConflict(e)) {
      return NextResponse.json({ error: `Key ${key.key} is already used by another product` }, { status: 409 });
    }
    if (msg.includes("unique") || msg.includes("duplicate")) {
      return NextResponse.json({ error: "Product already exists in this org" }, { status: 409 });
    }
    throw e;
  }
}
