import { initDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@vercel/postgres";

export async function PATCH(request: NextRequest) {
  await initDb();
  const body = await request.json();
  const { ids } = body;

  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: "ids array is required" }, { status: 400 });
  }

  for (let i = 0; i < ids.length; i++) {
    await sql`UPDATE boards SET position = ${i} WHERE id = ${ids[i]}`;
  }

  return NextResponse.json({ ok: true });
}
