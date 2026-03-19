import { NextRequest, NextResponse } from "next/server";
import { getDb, slugify } from "@/lib/db";

export async function GET() {
  const db = getDb();
  const orgs = db.prepare("SELECT * FROM organizations ORDER BY position, name").all();
  return NextResponse.json(orgs);
}

export async function POST(request: NextRequest) {
  const { name, slug: customSlug } = await request.json();
  if (!name) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  const db = getDb();
  const slug = customSlug || slugify(name);
  const maxPos = db.prepare("SELECT COALESCE(MAX(position), -1) as max FROM organizations").get() as { max: number };

  try {
    const result = db.prepare(
      "INSERT INTO organizations (name, slug, position) VALUES (?, ?, ?)"
    ).run(name, slug, maxPos.max + 1);
    const org = db.prepare("SELECT * FROM organizations WHERE id = ?").get(result.lastInsertRowid);
    return NextResponse.json(org, { status: 201 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    if (msg.includes("UNIQUE")) {
      return NextResponse.json({ error: "Organization already exists" }, { status: 409 });
    }
    throw e;
  }
}
