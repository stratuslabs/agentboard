import { initDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/sql";
import { notifyBoards } from "@/lib/realtime/notify";

export async function PATCH(request: NextRequest) {
  await initDb();
  const body = await request.json();
  const { ids } = body;

  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: "ids array is required" }, { status: 400 });
  }

  for (let i = 0; i < ids.length; i++) {
    await sql`UPDATE boards SET position = ${i}, updated_at = NOW() WHERE id = ${ids[i]}`;
  }

  await notifyBoards(ids);

  return NextResponse.json({ ok: true });
}
