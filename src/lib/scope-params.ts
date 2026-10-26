import { sql } from "./sql";
import { TenantError, parseId } from "./tenant";

/**
 * Where a list request points, by id or by slug.
 *
 * The list endpoints have always taken ids (`product_id=12`). Agents and
 * scripts know slugs (`product=agentboard`), and before this a slug got a bare
 * "product_id is required", or was ignored outright and the whole team's rows
 * came back. Each level now takes either form:
 *
 *   org_id=     | org=      unique per team
 *   product_id= | product=  unique per org: add org= when it's in more than one
 *   board_id=   | board=    unique per product: needs product= or product_id=
 *   column_id=  | column=   unique per board: needs board= or board_id=
 *
 * A slug the caller typed fails loud: 404 naming it when nothing matches, 400
 * when it is ambiguous or has no parent to look in. An id must be a valid row
 * id (400 otherwise) and is then passed through, so every route keeps its
 * existing id behavior (another team's id reading as an empty list,
 * /api/board falling back to the first board for a stale board_id). Lookups
 * are scoped to the caller's team.
 */
export const SCOPE_LEVELS = ["org", "product", "board", "column"] as const;
export type ScopeLevel = (typeof SCOPE_LEVELS)[number];

/** Each level's id, as a string: the caller's own *_id, or the one its slug resolved to. */
export type Scope = Partial<Record<ScopeLevel, string>>;

const LABEL: Record<ScopeLevel, string> = {
  org: "Organization",
  product: "Product",
  board: "Board",
  column: "Column",
};

const PARENT: Record<ScopeLevel, ScopeLevel | null> = {
  org: null,
  product: "org",
  board: "product",
  column: "board",
};

const fail = (status: number, message: string): never => {
  throw new TenantError(status, message);
};

type Found = { id: number; parent_slug?: string };

async function lookup(teamId: number, level: ScopeLevel, slug: string, parentId: number | null): Promise<Found[]> {
  switch (level) {
    case "org":
      return (await sql`
        SELECT id FROM organizations WHERE team_id = ${teamId} AND slug = ${slug}
      `).rows as Found[];
    case "product":
      return (await sql`
        SELECT p.id, o.slug AS parent_slug FROM products p
        JOIN organizations o ON o.id = p.org_id
        WHERE o.team_id = ${teamId} AND p.slug = ${slug}
          AND (${parentId}::int IS NULL OR p.org_id = ${parentId})
        ORDER BY o.slug
      `).rows as Found[];
    case "board":
      return (await sql`
        SELECT b.id FROM boards b
        JOIN products p ON p.id = b.product_id
        JOIN organizations o ON o.id = p.org_id
        WHERE o.team_id = ${teamId} AND b.slug = ${slug} AND b.product_id = ${parentId}
      `).rows as Found[];
    case "column":
      return (await sql`
        SELECT c.id FROM columns c
        JOIN boards b ON b.id = c.board_id
        JOIN products p ON p.id = b.product_id
        JOIN organizations o ON o.id = p.org_id
        WHERE o.team_id = ${teamId} AND c.slug = ${slug} AND c.board_id = ${parentId}
      `).rows as Found[];
  }
}

/**
 * Read the `levels` this endpoint accepts from `params`. Levels it doesn't
 * accept are left alone, so a route's other query params are unaffected.
 */
export async function resolveScope(
  teamId: number,
  params: URLSearchParams,
  levels: readonly ScopeLevel[],
): Promise<Scope> {
  const scope: Scope = {};
  // How each level was given, for messages: the slug, or "" for an id.
  const named: Partial<Record<ScopeLevel, string>> = {};

  for (const level of SCOPE_LEVELS) {
    if (!levels.includes(level)) continue;
    // An empty value is no value, as the routes have always treated it.
    const id = params.get(`${level}_id`) || null;
    const slug = params.get(level) || null;

    if (id && slug) fail(400, `Pass ${level}_id or ${level}, not both`);

    if (id) {
      if (!/^[0-9]+$/.test(id)) {
        fail(400, `${level}_id takes a numeric id. To look it up by slug, pass ${level}=${id}`);
      }
      // Out of range or zero is a 400 here, not a database error later.
      scope[level] = String(parseId(id));
      named[level] = "";
      continue;
    }
    if (!slug) continue;

    const parent = PARENT[level];
    const parentGiven = parent !== null && scope[parent] !== undefined;
    // Products are the one level that is useful without a parent: their slug
    // is usually unique across the team, and when it isn't we say so.
    if (parent && parent !== "org" && !parentGiven) {
      fail(400, `${level}= needs ${parent}= or ${parent}_id: ${level} slugs are only unique within a ${parent}`);
    }
    const parentId = parentGiven ? parseId(scope[parent!]) : null;

    const rows = await lookup(teamId, level, slug, parentId);
    if (rows.length === 0) {
      const where = parentGiven && named[parent!] ? ` in ${parent === "org" ? "organization" : parent} '${named[parent!]}'` : "";
      fail(404, `${LABEL[level]} '${slug}' not found${where}`);
    }
    if (rows.length > 1) {
      const orgs = rows.map((r) => r.parent_slug).join(", ");
      fail(400, `${LABEL[level]} '${slug}' is in more than one organization (${orgs}). Add org=<slug> or pass ${level}_id`);
    }
    scope[level] = String(rows[0].id);
    named[level] = slug;
  }
  return scope;
}
