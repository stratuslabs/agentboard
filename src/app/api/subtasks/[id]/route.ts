import { initDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/sql";
import { boardIdForCard, notifyBoard } from "@/lib/realtime/notify";
import { parseCardId } from "@/lib/card-location";
import { parseSubtaskUpdate } from "@/lib/subtasks";

// Sub-task ids are SERIAL integers like card ids, so the same strict parse
// applies: "1.0" or "12abc" is not a sub-task.
const parseSubtaskId = parseCardId;

async function touchCard(cardId: number) {
  await sql`UPDATE cards SET updated_at = NOW() WHERE id = ${cardId}`;
  await notifyBoard(await boardIdForCard(cardId));
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await initDb();
  const id = parseSubtaskId((await params).id);
  if (id === null) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { rows } = await sql`SELECT * FROM subtasks WHERE id = ${id}`;
  if (rows.length === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(rows[0]);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await initDb();
  const id = parseSubtaskId((await params).id);
  if (id === null) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "body must be JSON" }, { status: 400 });
  }
  const parsed = parseSubtaskUpdate(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const { title, done } = parsed.value;
  // COALESCE keeps a field the request didn't name.
  const { rows } = await sql`
    UPDATE subtasks
       SET title = COALESCE(${title ?? null}::text, title),
           done = COALESCE(${done ?? null}::boolean, done),
           updated_at = NOW()
     WHERE id = ${id}
     RETURNING *
  `;
  if (rows.length === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await touchCard(rows[0].card_id);
  return NextResponse.json(rows[0]);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await initDb();
  const id = parseSubtaskId((await params).id);
  if (id === null) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { rows } = await sql`DELETE FROM subtasks WHERE id = ${id} RETURNING card_id`;
  if (rows.length === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await touchCard(rows[0].card_id);
  return NextResponse.json({ success: true });
}
