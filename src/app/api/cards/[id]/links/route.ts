import { initDb } from "../../../../../lib/db";
import { NextRequest, NextResponse } from "next/server";
import { sql } from "../../../../../lib/sql";
import { boardIdForCard, notifyBoard } from "../../../../../lib/realtime/notify";
import { cardIdFromRef } from "../../../../../lib/card-location";
import { parseCardLink, parseLinkUrl } from "../../../../../lib/card-links";
import { withTenantParams } from "../../../../../lib/tenant";

// Links on a card: any http(s) URL, such as a Slack thread, a doc or a design.
// GET lists them in the order added, POST adds one (or retitles it if the URL
// is already linked), DELETE removes one by URL.

async function cardExists(id: number): Promise<boolean> {
  const { rows } = await sql`SELECT 1 FROM cards WHERE id = ${id}`;
  return rows.length > 0;
}

async function readJson(request: NextRequest): Promise<{ ok: true; body: unknown } | { ok: false }> {
  try {
    return { ok: true, body: await request.json() };
  } catch {
    return { ok: false };
  }
}

// Every write bumps the card, so board deltas and the realtime stream see it.
async function touchCard(teamId: number, cardId: number) {
  await sql`UPDATE cards SET updated_at = NOW() WHERE id = ${cardId}`;
  await notifyBoard(teamId, await boardIdForCard(cardId));
}

const notFound = () => NextResponse.json({ error: "Card not found" }, { status: 404 });

export const GET = withTenantParams<{ id: string }>(async (_request, { teamId }, { params }) => {
  await initDb();
  const id = await cardIdFromRef(teamId, (await params).id);
  if (id === null || !(await cardExists(id))) return notFound();
  const { rows } = await sql`SELECT * FROM card_links WHERE card_id = ${id} ORDER BY id`;
  return NextResponse.json(rows);
});

export const POST = withTenantParams<{ id: string }>(async (request: NextRequest, { teamId }, { params }) => {
  await initDb();
  const id = await cardIdFromRef(teamId, (await params).id);
  if (id === null) return notFound();

  const json = await readJson(request);
  if (!json.ok) return NextResponse.json({ error: "body must be JSON" }, { status: 400 });
  const parsed = parseCardLink(json.body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  if (!(await cardExists(id))) return notFound();

  // The same URL twice is one link: a retried command doesn't duplicate it.
  // A title sent the second time replaces the old one; no title keeps it.
  // xmax = 0 only on a freshly inserted row, which tells 201 from 200.
  const { rows } = await sql`
    INSERT INTO card_links (card_id, url, title)
    VALUES (${id}, ${parsed.value.url}, ${parsed.value.title})
    ON CONFLICT (card_id, url)
      DO UPDATE SET title = COALESCE(EXCLUDED.title, card_links.title)
    RETURNING *, (xmax = 0) AS inserted
  `;
  const { inserted, ...link } = rows[0];

  await touchCard(teamId, id);
  return NextResponse.json(link, { status: inserted ? 201 : 200 });
});

export const DELETE = withTenantParams<{ id: string }>(async (request: NextRequest, { teamId }, { params }) => {
  await initDb();
  const id = await cardIdFromRef(teamId, (await params).id);
  if (id === null) return notFound();

  const json = await readJson(request);
  if (!json.ok) return NextResponse.json({ error: "body must be JSON with the url to remove" }, { status: 400 });
  const body = json.body as Record<string, unknown> | null;
  const url = parseLinkUrl(body && typeof body === "object" ? body.url : undefined);
  if (!url.ok) return NextResponse.json({ error: url.error }, { status: 400 });

  if (!(await cardExists(id))) return notFound();

  const { rows } = await sql`
    DELETE FROM card_links WHERE card_id = ${id} AND url = ${url.value} RETURNING id
  `;
  if (rows.length === 0) {
    return NextResponse.json({ error: "No link with that url on this card" }, { status: 404 });
  }

  await touchCard(teamId, id);
  return NextResponse.json({ success: true });
});
