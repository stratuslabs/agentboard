import { initDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/sql";

export async function PATCH(request: NextRequest) {
  await initDb();
  const { ids } = await request.json();

  if (!Array.isArray(ids)) {
    return NextResponse.json({ error: "ids must be an array" }, { status: 400 });
  }

  for (let i = 0; i < ids.length; i++) {
    await sql`UPDATE cards SET position = ${i}, updated_at = NOW() WHERE id = ${ids[i]}`;
  }

  return NextResponse.json({ ok: true });
}
