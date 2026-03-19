import { NextRequest, NextResponse } from "next/server";
import { getDb, slugify, createDefaultBoards } from "@/lib/db";

export async function GET(request: NextRequest) {
  const db = getDb();
  const orgId = request.nextUrl.searchParams.get("org_id");

  let products;
  if (orgId) {
    products = db.prepare("SELECT * FROM products WHERE org_id = ? ORDER BY position, name").all(orgId);
  } else {
    products = db.prepare("SELECT * FROM products ORDER BY position, name").all();
  }
  return NextResponse.json(products);
}

export async function POST(request: NextRequest) {
  const { org_id, name, emoji } = await request.json();
  if (!org_id || !name) {
    return NextResponse.json({ error: "org_id and name are required" }, { status: 400 });
  }

  const db = getDb();
  const slug = slugify(name);
  const maxPos = db.prepare("SELECT COALESCE(MAX(position), -1) as max FROM products WHERE org_id = ?").get(org_id) as { max: number };

  try {
    const result = db.prepare(
      "INSERT INTO products (org_id, name, slug, emoji, position) VALUES (?, ?, ?, ?, ?)"
    ).run(org_id, name, slug, emoji || "📦", maxPos.max + 1);

    const productId = result.lastInsertRowid as number;
    createDefaultBoards(productId);

    const product = db.prepare("SELECT * FROM products WHERE id = ?").get(productId);
    return NextResponse.json(product, { status: 201 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    if (msg.includes("UNIQUE")) {
      return NextResponse.json({ error: "Product already exists in this org" }, { status: 409 });
    }
    throw e;
  }
}
