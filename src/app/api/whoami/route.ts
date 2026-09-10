import { initDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/sql";
import { aliasesForColumns } from "@/lib/status";

/**
 * `GET /api/whoami` — the grounding call.
 *
 * The CLI leans on `AGENTBOARD_PRODUCT` and `AGENTBOARD_BOARD` and refuses to
 * guess when they are unset. That works when a human exported them. An agent
 * arriving over MCP has no env vars at all — it gets a URL and a token — so
 * without this endpoint its first list or create call fails on an
 * ambiguous-board error it has no way to act on. That failure is what makes an
 * integration feel broken rather than merely unconfigured.
 *
 * So this returns the whole tree in one call: orgs, products, boards, the
 * columns each board actually has, the status vocabulary that resolves against
 * those columns, and a default board when there is exactly one to default to.
 *
 * It deliberately does **not** auto-register the caller as a member. Every
 * other route treats `X-Agent-Name` as a registration trigger, but this one is
 * the call an agent makes *first*, on every connection, often just to look
 * around — and a read that silently creates rows would fill `members` with
 * agents that never went on to touch a card.
 */
export async function GET(request: NextRequest) {
  await initDb();

  const agentName = request.headers.get("x-agent-name");
  let member: {
    id: number;
    name: string;
    type: string;
    color: string;
  } | null = null;

  if (agentName) {
    const { rows } = await sql`
      SELECT id, name, type, color FROM members WHERE name = ${agentName}
    `;
    member = rows.length > 0 ? rows[0] : null;
  }

  const { rows: boardRows } = await sql`
    SELECT
      o.id   AS org_id,   o.name AS org_name,   o.slug AS org_slug,
      p.id   AS product_id, p.name AS product_name, p.slug AS product_slug,
      p.emoji AS product_emoji,
      b.id   AS board_id, b.name AS board_name, b.slug AS board_slug
    FROM boards b
    JOIN products p ON b.product_id = p.id
    JOIN organizations o ON p.org_id = o.id
    ORDER BY o.position, o.id, p.position, p.id, b.position, b.id
  `;

  const { rows: columnRows } = await sql`
    SELECT board_id, id, name, slug, position
    FROM columns
    ORDER BY board_id, position, id
  `;

  const columnsByBoard = new Map<
    number,
    { id: number; name: string; slug: string }[]
  >();
  for (const c of columnRows) {
    const list = columnsByBoard.get(c.board_id) ?? [];
    list.push({ id: c.id, name: c.name, slug: c.slug });
    columnsByBoard.set(c.board_id, list);
  }

  type Board = {
    id: number;
    name: string;
    slug: string;
    columns: { id: number; name: string; slug: string }[];
    status_aliases: Record<string, string>;
  };
  type Product = {
    id: number;
    name: string;
    slug: string;
    emoji: string;
    boards: Board[];
  };
  type Org = { id: number; name: string; slug: string; products: Product[] };

  const orgs: Org[] = [];
  const orgById = new Map<number, Org>();
  const productById = new Map<number, Product>();

  for (const r of boardRows) {
    let org = orgById.get(r.org_id);
    if (!org) {
      org = { id: r.org_id, name: r.org_name, slug: r.org_slug, products: [] };
      orgById.set(r.org_id, org);
      orgs.push(org);
    }

    let product = productById.get(r.product_id);
    if (!product) {
      product = {
        id: r.product_id,
        name: r.product_name,
        slug: r.product_slug,
        emoji: r.product_emoji,
        boards: [],
      };
      productById.set(r.product_id, product);
      org.products.push(product);
    }

    const columns = columnsByBoard.get(r.board_id) ?? [];
    product.boards.push({
      id: r.board_id,
      name: r.board_name,
      slug: r.board_slug,
      columns,
      status_aliases: aliasesForColumns(columns.map((c) => c.slug)),
    });
  }

  // A default only makes sense when there is nothing to choose between. With
  // two boards, picking one for the caller would silently write to the wrong
  // place; the caller should be told to name one instead.
  const allBoards = boardRows.map((r) => ({
    board_id: r.board_id,
    board_slug: r.board_slug,
    product_slug: r.product_slug,
    org_slug: r.org_slug,
  }));
  const defaultBoard = allBoards.length === 1 ? allBoards[0] : null;

  return NextResponse.json({
    edition: "self-hosted",
    // Whether a credential was required to get here at all. An agent that finds
    // `"open"` is talking to a board anyone on the network can write to.
    auth: process.env.APP_PASSWORD ? "password" : "open",
    agent_name: agentName,
    member,
    member_registered: member !== null,
    orgs,
    default_board: defaultBoard,
    board_count: allBoards.length,
  });
}
