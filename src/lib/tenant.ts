import { NextRequest, NextResponse } from "next/server";
import { sql, db } from "@/lib/sql";
import { initDb } from "@/lib/db";
import { ensureDefaultTeam, ensureTeamDefaults } from "@/lib/tenancy";

/**
 * Which team a request acts for.
 *
 * Every board-data query is scoped by team (see tenancy.js). The team comes
 * from here and only from here: never from a body, query string or header the
 * caller chooses. Self-hosted AgentBoard has one team, so every request
 * resolves to it. The hosted edition swaps in its own resolver (signed-in
 * user's active team, or the team an API key belongs to) with
 * setTenantResolver.
 */
export type TenantContext = {
  teamId: number;
};

/** Thrown by the guards below; withTenant turns it into a response. */
export class TenantError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export type TenantResolver = {
  /** For route handlers. May throw TenantError (401, 402, ...). */
  fromRequest: (request: Request) => Promise<TenantContext>;
  /** For server components, which have no Request object. */
  fromPage: () => Promise<TenantContext>;
};

let defaultTeamId: Promise<number> | null = null;

const query = (text: string, values?: unknown[]) => db.query(text, values);

/**
 * The self-hosted team, created with its default settings on first use. Here
 * rather than in ensureTables, so an edition whose teams are created by sign-up
 * never gets a stray one.
 */
function selfHostedTeam(): Promise<TenantContext> {
  defaultTeamId ??= initDb()
    .then(async () => {
      const teamId = await ensureDefaultTeam(query);
      await ensureTeamDefaults(query, teamId);
      return teamId;
    })
    .catch((err) => {
      // Not cached, so a database that was briefly down is retried next time.
      defaultTeamId = null;
      throw err;
    });
  return defaultTeamId.then((teamId) => ({ teamId }));
}

const selfHosted: TenantResolver = {
  fromRequest: () => selfHostedTeam(),
  fromPage: () => selfHostedTeam(),
};

let resolver: TenantResolver = selfHosted;

/**
 * Replace how the team is resolved. For the hosted edition, and for tests that
 * need two teams; self-hosted never calls it.
 */
export function setTenantResolver(next: Partial<TenantResolver> | null) {
  resolver = next ? { ...selfHosted, ...next } : selfHosted;
}

export async function resolveTenant(request: Request): Promise<TenantContext> {
  await initDb();
  return resolver.fromRequest(request);
}

/** The team for a server component. */
export async function pageTenant(): Promise<TenantContext> {
  await initDb();
  return resolver.fromPage();
}

function tenantErrorResponse(e: unknown): Response {
  if (e instanceof TenantError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  throw e;
}

/**
 * Wrap a route handler so it always runs with a resolved team, and so a
 * TenantError from a guard becomes its status instead of a 500.
 */
export function withTenant(
  handler: (request: NextRequest, ctx: TenantContext) => Promise<Response>,
) {
  return async (request: NextRequest): Promise<Response> => {
    try {
      const ctx = await resolveTenant(request);
      return await handler(request, ctx);
    } catch (e) {
      return tenantErrorResponse(e);
    }
  };
}

/** Same, for routes with a dynamic `[id]` segment. */
export function withTenantParams<P>(
  handler: (request: NextRequest, ctx: TenantContext, params: { params: Promise<P> }) => Promise<Response>,
) {
  return async (request: NextRequest, params: { params: Promise<P> }): Promise<Response> => {
    try {
      const ctx = await resolveTenant(request);
      return await handler(request, ctx, params);
    } catch (e) {
      return tenantErrorResponse(e);
    }
  };
}

// ── Ownership guards ──────────────────────────────────────────────────
//
// Every board-data row reaches its team by joining up to
// organizations.team_id. Each guard returns the row's id when it belongs to
// the team and throws 404 otherwise: 404 rather than 403, so another team's
// ids can't be probed for. The same names and shapes as the hosted edition's.

/** Largest value a Postgres INTEGER (and so a SERIAL id) can hold. */
const MAX_ID = 2147483647;

/**
 * A row id, strictly: "12abc", "1.0" or "0x10" is not one, and a value
 * Postgres can't cast must never reach a query.
 */
export function parseId(value: unknown): number {
  const text = typeof value === "number" || typeof value === "string" ? String(value) : "";
  if (!/^[1-9][0-9]{0,9}$/.test(text) || Number(text) > MAX_ID) {
    throw new TenantError(400, "Invalid id");
  }
  return Number(text);
}

/**
 * A guard's id, or null when the row isn't the team's. For a route that
 * answers a missing row its own way; anything else still throws.
 */
export async function found(check: Promise<number>): Promise<number | null> {
  try {
    return await check;
  } catch (e) {
    if (e instanceof TenantError && e.status === 404) return null;
    throw e;
  }
}

async function guard(query: Promise<{ rows: unknown[] }>, id: number): Promise<number> {
  const { rows } = await query;
  if (rows.length === 0) throw new TenantError(404, "Not found");
  return id;
}

export async function assertOrg(teamId: number, orgId: unknown): Promise<number> {
  const id = parseId(orgId);
  return guard(sql`SELECT 1 FROM organizations WHERE id = ${id} AND team_id = ${teamId}`, id);
}

export async function assertProduct(teamId: number, productId: unknown): Promise<number> {
  const id = parseId(productId);
  return guard(sql`
    SELECT 1 FROM products p
    JOIN organizations o ON o.id = p.org_id
    WHERE p.id = ${id} AND o.team_id = ${teamId}
  `, id);
}

export async function assertBoard(teamId: number, boardId: unknown): Promise<number> {
  const id = parseId(boardId);
  return guard(sql`
    SELECT 1 FROM boards b
    JOIN products p ON p.id = b.product_id
    JOIN organizations o ON o.id = p.org_id
    WHERE b.id = ${id} AND o.team_id = ${teamId}
  `, id);
}

export async function assertColumn(teamId: number, columnId: unknown): Promise<number> {
  const id = parseId(columnId);
  return guard(sql`
    SELECT 1 FROM columns c
    JOIN boards b ON b.id = c.board_id
    JOIN products p ON p.id = b.product_id
    JOIN organizations o ON o.id = p.org_id
    WHERE c.id = ${id} AND o.team_id = ${teamId}
  `, id);
}

export async function assertCard(teamId: number, cardId: unknown): Promise<number> {
  const id = parseId(cardId);
  return guard(sql`
    SELECT 1 FROM cards cd
    JOIN columns c ON c.id = cd.column_id
    JOIN boards b ON b.id = c.board_id
    JOIN products p ON p.id = b.product_id
    JOIN organizations o ON o.id = p.org_id
    WHERE cd.id = ${id} AND o.team_id = ${teamId}
  `, id);
}

export async function assertAttachment(teamId: number, attachmentId: unknown): Promise<number> {
  const id = parseId(attachmentId);
  return guard(sql`
    SELECT 1 FROM attachments a
    JOIN cards cd ON cd.id = a.card_id
    JOIN columns c ON c.id = cd.column_id
    JOIN boards b ON b.id = c.board_id
    JOIN products p ON p.id = b.product_id
    JOIN organizations o ON o.id = p.org_id
    WHERE a.id = ${id} AND o.team_id = ${teamId}
  `, id);
}

export async function assertSubtask(teamId: number, subtaskId: unknown): Promise<number> {
  const id = parseId(subtaskId);
  return guard(sql`
    SELECT 1 FROM subtasks s
    JOIN cards cd ON cd.id = s.card_id
    JOIN columns c ON c.id = cd.column_id
    JOIN boards b ON b.id = c.board_id
    JOIN products p ON p.id = b.product_id
    JOIN organizations o ON o.id = p.org_id
    WHERE s.id = ${id} AND o.team_id = ${teamId}
  `, id);
}

export async function assertMember(teamId: number, memberId: unknown): Promise<number> {
  const id = parseId(memberId);
  return guard(sql`SELECT 1 FROM members WHERE id = ${id} AND team_id = ${teamId}`, id);
}

/**
 * An ordered id list for a reorder route, every one in the team. Checked
 * before anything is written, so a list with one foreign id changes nothing.
 */
export async function assertAllInTeam(
  teamId: number,
  ids: unknown,
  assert: (teamId: number, id: unknown) => Promise<number>,
): Promise<number[]> {
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new TenantError(400, "ids array is required");
  }
  return Promise.all(ids.map((id) => assert(teamId, id)));
}
