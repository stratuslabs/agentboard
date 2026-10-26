import { NextResponse } from "next/server";

/** The JSON 404 for an /api path no route serves, naming the method and path. */
export function apiNotFound(request: Request): Response {
  const { pathname } = new URL(request.url);
  return NextResponse.json({ error: `No API route for ${request.method} ${pathname}` }, { status: 404 });
}
