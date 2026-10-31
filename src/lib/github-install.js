// AgentBoard GitHub App (card 1000): connecting an installation to a team.
//
// "Connect GitHub" in Settings sends the browser to the App's install page
// with a signed `state`. With "Request user authorization (OAuth) during
// installation" turned on, GitHub comes back to the callback with
// `installation_id`, `code` and that `state`. The callback:
//
//   1. checks `state`: signed by us, for the team now signed in, from the
//      browser that started (a nonce kept in a cookie), less than ten minutes old;
//   2. exchanges `code` for a user token and lists the installations that
//      user can reach (GET /user/installations);
//   3. binds the installation to the team only if it's in that list.
//
// Step 3 is the security check: `installation_id` is just a query parameter,
// so without it anyone could bind someone else's installation to their own
// board and have that account's PRs reach their cards. The user token is used
// for that one list and then dropped; nothing about the user is stored.
//
// No database here; the routes call bindInstallation() from github-webhook.ts.

import { createHmac, timingSafeEqual } from "node:crypto";

const STATE_TTL_MS = 10 * 60 * 1000;
const PER_PAGE = 100;
/** Stop after this many pages (10,000 installations) rather than loop forever on a misbehaving API. */
const MAX_PAGES = 100;

/**
 * The App's settings from the environment, or null when any is missing: then
 * the integration is off, its routes answer 404 and Settings doesn't show it.
 *
 * @param {Record<string, string | undefined>} env
 */
export function githubAppConfig(env = process.env) {
  const read = (name) => (typeof env[name] === "string" && env[name].trim() !== "" ? env[name].trim() : null);
  const slug = read("GITHUB_APP_SLUG");
  const clientId = read("GITHUB_APP_CLIENT_ID");
  const clientSecret = read("GITHUB_APP_CLIENT_SECRET");
  const webhookSecret = read("GITHUB_APP_WEBHOOK_SECRET");
  if (!slug || !clientId || !clientSecret || !webhookSecret) return null;
  return { slug, clientId, clientSecret, webhookSecret };
}

/** The App's install page, carrying `state` back to our callback. */
export function installUrl(slug, state) {
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(slug)) throw new Error(`Not a GitHub App slug: ${slug}`);
  const url = new URL(`https://github.com/apps/${slug}/installations/new`);
  url.searchParams.set("state", state);
  return url.toString();
}

const stateKey = (secret) => createHmac("sha256", "agentboard-github-install-state").update(secret).digest();
const mac = (body, secret) => createHmac("sha256", stateKey(secret)).update(body).digest("base64url");

/**
 * A `state` for one install attempt: the team, the browser's nonce and an
 * expiry, HMAC-signed with a key derived from `secret` (the App's client
 * secret, which never leaves the server).
 */
export function signState({ teamId, nonce, now = Date.now() }, secret) {
  const body = Buffer.from(JSON.stringify({ t: teamId, n: nonce, e: now + STATE_TTL_MS })).toString("base64url");
  return `${body}.${mac(body, secret)}`;
}

/**
 * `{ teamId }` when `state` is ours, unexpired, for `teamId`, and was started
 * by the browser holding `nonce`; otherwise null. Never throws.
 */
export function readState(state, secret, { teamId, nonce, now = Date.now() }) {
  if (typeof state !== "string" || typeof nonce !== "string" || nonce === "" || !secret) return null;
  const parts = state.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [body, given] = parts;
  const expected = Buffer.from(mac(body, secret));
  const actual = Buffer.from(given);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  let data;
  try {
    data = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  if (data.t !== teamId || data.n !== nonce) return null;
  if (typeof data.e !== "number" || now > data.e) return null;
  return { teamId };
}

/** A failure the callback shows the user, with the HTTP status that fits it. */
export class InstallError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "InstallError";
    this.status = status;
  }
}

function parseInstallationId(value) {
  const text = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  if (!/^[1-9][0-9]{0,15}$/.test(text)) return null;
  const n = Number(text);
  return Number.isSafeInteger(n) ? n : null;
}

async function call(fetchImpl, url, init, what) {
  let res;
  try {
    res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(10_000) });
  } catch {
    throw new InstallError(502, `Couldn't reach GitHub to ${what}. Try again.`);
  }
  if (!res.ok) throw new InstallError(502, `GitHub answered ${res.status} when asked to ${what}. Try again.`);
  try {
    return await res.json();
  } catch {
    throw new InstallError(502, `GitHub sent an unreadable answer when asked to ${what}.`);
  }
}

/**
 * Exchange the OAuth `code` from the callback and confirm the user who
 * authorized can reach `installationId`. Resolves to the installation and the
 * account it's on; throws InstallError (400 bad input or an expired code, 403
 * an installation the user can't reach, 502 GitHub trouble).
 *
 * @param {{ code: unknown, installationId: unknown, config: { clientId: string, clientSecret: string },
 *           fetch?: typeof fetch }} args
 */
export async function completeInstall({ code, installationId, config, fetch: fetchImpl = fetch }) {
  const id = parseInstallationId(installationId);
  if (typeof code !== "string" || code === "" || id === null) {
    throw new InstallError(400, "GitHub didn't send back an installation and authorization. Start again from Settings.");
  }

  const grant = await call(
    fetchImpl,
    "https://github.com/login/oauth/access_token",
    {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: config.clientId, client_secret: config.clientSecret, code }),
    },
    "confirm your GitHub sign-in"
  );
  const token = grant && typeof grant.access_token === "string" ? grant.access_token : null;
  if (!token) {
    throw new InstallError(400, "GitHub's sign-in code had expired or was already used. Start again from Settings.");
  }

  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `https://api.github.com/user/installations?per_page=${PER_PAGE}&page=${page}`;
    const data = await call(fetchImpl, url, { headers }, "list your installations");
    const list = Array.isArray(data?.installations) ? data.installations : [];
    const hit = list.find((i) => i && i.id === id);
    if (hit) {
      const login = typeof hit.account?.login === "string" ? hit.account.login : null;
      return { installationId: id, accountLogin: login };
    }
    if (list.length < PER_PAGE) break;
  }
  throw new InstallError(403, "Your GitHub account can't access that installation, so it wasn't connected.");
}
