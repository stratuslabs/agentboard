import { initDb, slugify } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@vercel/postgres";

const DEFAULT_COLUMNS = [
  { name: "Backlog", color: "#6B7280" },
  { name: "Todo", color: "#3B82F6" },
  { name: "In Progress", color: "#F59E0B" },
  { name: "In Review", color: "#8B5CF6" },
  { name: "Done", color: "#10B981" },
];

export async function GET(request: NextRequest) {
  await initDb();
  const productId = request.nextUrl.searchParams.get("product_id");

  if (!productId) {
    return NextResponse.json({ error: "product_id is required" }, { status: 400 });
  }

  const { rows } = await sql`SELECT * FROM boards WHERE product_id = ${productId} ORDER BY position`;
  return NextResponse.json(rows);
}

export async function POST(request: NextRequest) {
  await initDb();
  const body = await request.json();
  const { product_id, name } = body;

  if (!product_id || !name) {
    return NextResponse.json({ error: "product_id and name are required" }, { status: 400 });
  }

  const slug = slugify(name);

  // Set position to max+1
  const { rows: maxRows } = await sql`SELECT COALESCE(MAX(position), -1) AS max_pos FROM boards WHERE product_id = ${product_id}`;
  const position = maxRows[0].max_pos + 1;

  const { rows } = await sql`
    INSERT INTO boards (product_id, name, slug, position)
    VALUES (${product_id}, ${name}, ${slug}, ${position})
    RETURNING *
  `;
  const board = rows[0];

  // Create default columns
  for (let j = 0; j < DEFAULT_COLUMNS.length; j++) {
    const col = DEFAULT_COLUMNS[j];
    const colSlug = slugify(col.name);
    await sql`
      INSERT INTO columns (board_id, name, slug, position, color)
      VALUES (${board.id}, ${col.name}, ${colSlug}, ${j}, ${col.color})
    `;
  }

  return NextResponse.json(board, { status: 201 });
}
