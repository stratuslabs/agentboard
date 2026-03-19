import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET(request: NextRequest) {
  const db = getDb();
  const productId = request.nextUrl.searchParams.get("product_id");

  if (!productId) {
    return NextResponse.json({ error: "product_id is required" }, { status: 400 });
  }

  const boards = db.prepare("SELECT * FROM boards WHERE product_id = ? ORDER BY position").all(productId);
  return NextResponse.json(boards);
}
