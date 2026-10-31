import { NextRequest, NextResponse } from "next/server";
import { initDb } from "../../../../../lib/db";
import { verifySignature } from "../../../../../lib/github-app";
import { githubAppConfig } from "../../../../../lib/github-install";
import { handleGithubEvent } from "../../../../../lib/github-webhook";
import { publicOrigin } from "../../../../../lib/public-url";

export const runtime = "nodejs";

/**
 * GitHub App webhook (card 1000). Public: GitHub can't sign in, so the
 * middleware lets this path through and the X-Hub-Signature-256 check below is
 * the authentication. The signature is checked on the exact bytes received,
 * before anything is parsed. 404 when the App isn't configured.
 */
export async function POST(request: NextRequest) {
  const config = githubAppConfig();
  if (!config) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const raw = Buffer.from(await request.arrayBuffer());
  if (!verifySignature(config.webhookSecret, raw, request.headers.get("x-hub-signature-256"))) {
    return NextResponse.json({ error: "Bad signature" }, { status: 401 });
  }

  const event = request.headers.get("x-github-event");
  const deliveryId = request.headers.get("x-github-delivery");
  if (!event || !deliveryId) {
    return NextResponse.json({ error: "Missing X-GitHub-Event or X-GitHub-Delivery" }, { status: 400 });
  }
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(raw.toString("utf8"));
  } catch {
    return NextResponse.json({ error: "Body is not JSON" }, { status: 400 });
  }

  await initDb();
  const result = await handleGithubEvent({ event, deliveryId, payload, origin: publicOrigin(request) });
  if (result.status === 204) return new NextResponse(null, { status: 204 });
  return NextResponse.json(result.body, { status: result.status });
}
