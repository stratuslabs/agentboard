import { initDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@vercel/postgres";

export async function PATCH(request: NextRequest) {
  await initDb();
  const { ids } = await request.json(); // ordered array of org IDs

  if (!Array.isArray(ids)) {
    return NextResponse.json({ error: "ids array required" }, { status: 400 });
  }

  for (let i = 0; i < ids.length; i++) {
    await sql`UPDATE organizations SET position = ${i} WHERE id = ${ids[i]}`;
  }

  return NextResponse.json({ success: true });
}
