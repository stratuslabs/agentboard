import { NextRequest, NextResponse } from "next/server";

/**
 * Any /api path no other route claims.
 *
 * Without this, Next falls through to the pages: a two-segment path like
 * `/api/tasks` reads as org "api", product "tasks" and gets the board page's
 * HTML with a 200, and a deeper one gets the HTML not-found page. A client
 * that guessed a path, or wrote to one, was told it worked or handed HTML to
 * parse. A static segment outranks a dynamic one, so this catches every
 * unknown /api path and nothing a real route serves.
 *
 * The middleware runs first, so with a password set an unauthenticated caller
 * still gets its 401 and learns nothing about which paths exist.
 */
function notFound(request: NextRequest): Response {
  const { pathname } = request.nextUrl;
  return NextResponse.json({ error: `No API route for ${request.method} ${pathname}` }, { status: 404 });
}

export const GET = notFound;
export const POST = notFound;
export const PUT = notFound;
export const PATCH = notFound;
export const DELETE = notFound;
