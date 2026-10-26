import { notFound, redirect } from "next/navigation";
import { initDb } from "../../../../lib/db";
import { getCardWithLocation } from "../../../../lib/card-location";
import { pageTenant } from "../../../../lib/tenant";

/**
 * The permanent link to a card: `/c/AB-142`, or `/c/<id>`. Boards, products
 * and orgs can be renamed and cards move between them, so the link stores
 * only the card's key or id and looks up where the card lives now. Old keys
 * (a product key that was changed, a number from before a move) still
 * resolve. The board page then opens it from
 * `?card=<id>`, switching to the right board tab first if it has to.
 *
 * Auth is the middleware's job, same as every other page.
 */
export default async function CardPermalinkPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await initDb();
  const { teamId } = await pageTenant();
  const card = await getCardWithLocation(teamId, id);
  if (!card) notFound();

  const path = `/${encodeURIComponent(card.org_slug)}/${encodeURIComponent(card.product_slug)}`;
  redirect(`${path}?card=${card.id}`);
}
