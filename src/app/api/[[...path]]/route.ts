import { apiNotFound } from "../../../lib/api-not-found";
import { withTenant } from "../../../lib/tenant";

/**
 * Any /api path no other route claims.
 *
 * Without this, Next falls through to the pages: a two-segment path like
 * `/api/tasks` reads as org "api", product "tasks" and gets the board page's
 * HTML with a 200, and a deeper one gets the HTML not-found page. A client
 * that guessed a path, or wrote to one, was told it worked or handed HTML to
 * parse. A static segment outranks a dynamic one, so this catches every
 * unknown /api path and nothing a real route serves. It is an optional
 * catch-all so the bare /api root, which has no segment, lands here as well.
 *
 * It resolves the team first, like every real route. With a password set the
 * middleware has already answered 401; a consumer that authenticates in its
 * tenant resolver instead gets that resolver's 401 here too. Answering 404
 * before auth would tell a stranger which API routes exist.
 */
const notFound = withTenant(async (request) => apiNotFound(request));

export const GET = notFound;
export const POST = notFound;
export const PUT = notFound;
export const PATCH = notFound;
export const DELETE = notFound;
