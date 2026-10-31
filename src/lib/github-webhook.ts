import type { PoolClient } from "pg";
import { sql, withClient } from "./sql";
import { notifyBoards } from "./realtime/notify";
import { resolveCardRef } from "./card-keys";
import { appendHistory, cardRefsInBody, closeHistoryLine, normalizePrUrl } from "./github-app";

/**
 * What the GitHub App does with a webhook delivery (card 1000), once its
 * signature has been checked. A merged PR moves every card it is linked to
 * into its board's Done column and writes a History line; a PR closed without
 * merging only gets the line.
 *
 * Only cards in the team the delivering installation is bound to are looked
 * at, so a PR can never reach another team's board, even through a card URL
 * in its body. Everything a delivery changes, and the record that it was
 * handled, commit together: a redelivery finds the record and does nothing.
 */

export type GithubEventResult = {
  status: 200 | 204 | 400;
  body: {
    outcome: "ignored" | "invalid" | "duplicate" | "unbound" | "processed" | "uninstalled";
    moved: number[];
    noted: number[];
    error?: string;
  };
};

type Payload = Record<string, unknown> | null | undefined;

const result = (
  status: GithubEventResult["status"],
  outcome: GithubEventResult["body"]["outcome"],
  extra: Partial<GithubEventResult["body"]> = {}
): GithubEventResult => ({ status, body: { outcome, moved: [], noted: [], ...extra } });

const obj = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

function installationId(payload: Payload): number | null {
  const id = obj(obj(payload)?.installation)?.id;
  return typeof id === "number" && Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** Bind an installation to a team. Rebinding to the same team updates it; another team is refused. */
export async function bindInstallation({
  installationId,
  teamId,
  accountLogin = null,
  createdBy = null,
}: {
  installationId: number;
  teamId: number;
  accountLogin?: string | null;
  createdBy?: number | null;
}): Promise<void> {
  const { rows } = await sql`
    INSERT INTO github_installations (installation_id, team_id, account_login, created_by)
    VALUES (${installationId}, ${teamId}, ${accountLogin}, ${createdBy})
    ON CONFLICT (installation_id) DO UPDATE SET account_login = EXCLUDED.account_login
      WHERE github_installations.team_id = EXCLUDED.team_id
    RETURNING team_id
  `;
  if (rows.length === 0) {
    throw new Error("This GitHub installation is already connected to another team.");
  }
}

/** Claim a delivery id. False when it was already handled. */
async function claimDelivery(client: PoolClient, deliveryId: string, event: string, installation: number | null) {
  await client.query("DELETE FROM github_deliveries WHERE received_at < NOW() - INTERVAL '30 days'");
  const { rows } = await client.query(
    `INSERT INTO github_deliveries (delivery_id, event, installation_id) VALUES ($1, $2, $3)
     ON CONFLICT (delivery_id) DO NOTHING RETURNING delivery_id`,
    [deliveryId, event, installation]
  );
  return rows.length > 0;
}

async function inTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  return withClient(async (client: PoolClient) => {
    await client.query("BEGIN");
    try {
      const out = await fn(client);
      await client.query("COMMIT");
      return out;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    }
  });
}

type ClosedPr = { repo: string; number: number; url: string; merged: boolean; date: Date; body: string };

function closedPr(payload: Payload): ClosedPr | null {
  const pr = obj(obj(payload)?.pull_request);
  const repo = obj(obj(payload)?.repository)?.full_name;
  if (!pr || typeof repo !== "string" || !/^[^/\s]+\/[^/\s]+$/.test(repo)) return null;
  const number = pr.number;
  if (typeof number !== "number" || !Number.isSafeInteger(number) || number < 1) return null;
  const url = normalizePrUrl(pr.html_url);
  if (!url) return null;
  const when = (pr.merged === true ? pr.merged_at : pr.closed_at) ?? pr.closed_at;
  const date = typeof when === "string" && !Number.isNaN(Date.parse(when)) ? new Date(when) : new Date();
  return { repo, number, url, merged: pr.merged === true, date, body: typeof pr.body === "string" ? pr.body : "" };
}

/** The team's cards this PR is linked to, locked for the update. */
async function linkedCards(client: PoolClient, teamId: number, pr: ClosedPr, origin: string | null) {
  const inTeam = `
    JOIN columns col ON col.id = c.column_id
    JOIN boards b ON b.id = col.board_id
    JOIN products p ON p.id = b.product_id
    JOIN organizations o ON o.id = p.org_id AND o.team_id = $1`;
  // A coarse filter in SQL, then the exact comparison on normalized URLs, so
  // /pull/13 never matches /pull/130 and case or a /files suffix never matter.
  const pattern = `%/pull/${pr.number}%`;
  const { rows: candidates } = await client.query(
    `SELECT c.id, c.github_pr_url,
            COALESCE(ARRAY(SELECT l.url FROM card_links l WHERE l.card_id = c.id AND l.url ILIKE $2), '{}') AS links
       FROM cards c ${inTeam}
      WHERE c.github_pr_url ILIKE $2
         OR EXISTS (SELECT 1 FROM card_links l WHERE l.card_id = c.id AND l.url ILIKE $2)`,
    [teamId, pattern]
  );
  const ids = new Set<number>();
  for (const row of candidates) {
    const urls = [row.github_pr_url, ...(row.links as string[])];
    if (urls.some((u) => normalizePrUrl(u) === pr.url)) ids.add(row.id);
  }
  const query = (text: string, values?: unknown[]) => client.query(text, values);
  for (const ref of origin ? cardRefsInBody(pr.body, origin) : []) {
    const id = await resolveCardRef(query, teamId, ref);
    if (id !== null) ids.add(id);
  }
  if (ids.size === 0) return [];
  const { rows } = await client.query(
    `SELECT c.id, c.description, c.column_id, col.slug, col.board_id
       FROM cards c ${inTeam}
      WHERE c.id = ANY($2)
      ORDER BY c.id
      FOR UPDATE OF c`,
    [teamId, [...ids]]
  );
  return rows as { id: number; description: string | null; column_id: number; slug: string; board_id: number }[];
}

async function handleClosedPr(deliveryId: string, installation: number, pr: ClosedPr, origin: string | null) {
  const boards: number[] = [];
  let teamId: number | null = null;
  const out = await inTransaction(async (client) => {
    if (!(await claimDelivery(client, deliveryId, "pull_request", installation))) return result(200, "duplicate");
    const { rows: bound } = await client.query("SELECT team_id FROM github_installations WHERE installation_id = $1", [
      installation,
    ]);
    if (bound.length === 0) return result(200, "unbound");
    teamId = bound[0].team_id as number;

    const moved: number[] = [];
    const noted: number[] = [];
    for (const card of await linkedCards(client, teamId, pr, origin)) {
      if (pr.merged && card.slug === "done") continue;
      let doneColumn: number | null = null;
      if (pr.merged) {
        const { rows } = await client.query("SELECT id FROM columns WHERE board_id = $1 AND slug = 'done'", [
          card.board_id,
        ]);
        doneColumn = rows[0]?.id ?? null;
      }
      const outcome = !pr.merged ? "closed" : doneColumn === null ? "no-done-column" : "merged";
      const description = appendHistory(
        card.description,
        closeHistoryLine({ repo: pr.repo, number: pr.number, url: pr.url, outcome, date: pr.date })
      );
      if (doneColumn !== null) {
        // Same move as the manual one: to the end of the column, stamped.
        await client.query(
          `UPDATE cards SET column_id = $2, description = $3, updated_at = NOW(),
                  position = (SELECT COALESCE(MAX(position), -1) + 1 FROM cards WHERE column_id = $2)
            WHERE id = $1`,
          [card.id, doneColumn, description]
        );
        moved.push(card.id);
      } else {
        await client.query("UPDATE cards SET description = $2, updated_at = NOW() WHERE id = $1", [card.id, description]);
        noted.push(card.id);
      }
      boards.push(card.board_id);
    }
    return result(200, "processed", { moved, noted });
  });
  // After commit, so a client that refetches sees the change.
  if (teamId !== null && boards.length > 0) await notifyBoards(teamId, boards);
  return out;
}

/**
 * Handle one verified delivery. `origin` is this instance's public origin, for
 * card URLs in a PR body; without one, only the PR field and card links match.
 */
export async function handleGithubEvent({
  event,
  deliveryId,
  payload,
  origin,
}: {
  event: string;
  deliveryId: string;
  payload: Payload;
  origin: string | null;
}): Promise<GithubEventResult> {
  const action = obj(payload)?.action;
  const installation = installationId(payload);

  if (event === "installation" && action === "deleted") {
    if (installation === null) return result(400, "invalid", { error: "No installation id" });
    return inTransaction(async (client) => {
      if (!(await claimDelivery(client, deliveryId, event, installation))) return result(200, "duplicate");
      await client.query("DELETE FROM github_installations WHERE installation_id = $1", [installation]);
      return result(200, "uninstalled");
    });
  }

  if (event !== "pull_request" || action !== "closed") return result(204, "ignored");

  const pr = closedPr(payload);
  if (installation === null || pr === null) {
    return result(400, "invalid", { error: "Not a closed pull request payload" });
  }
  return handleClosedPr(deliveryId, installation, pr, origin);
}
