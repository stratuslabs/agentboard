// This app's own idea of a team: the `x-team` header names it, and a request
// without one is turned away. A real hosted edition would read a session or an
// API key here; the shape of the hook is the same.
//
// `paths` maps @/ to this app, as a hosted edition's would. The core must not
// depend on that alias (test/package-surface.test.mjs).
import { headers } from "next/headers";
import { db } from "@stratuslabs/agentboard-core/lib/sql";
import { ensureTeamDefaults } from "@stratuslabs/agentboard-core/lib/tenancy";
import { TenantError, type TenantContext } from "@stratuslabs/agentboard-core/lib/tenant";

const query = (text: string, values?: unknown[]) => db.query(text, values);

async function teamFor(slug: string | null): Promise<TenantContext> {
  if (!slug || !/^[a-z0-9-]{1,40}$/.test(slug)) throw new TenantError(401, "Unauthorized");
  const { rows } = await query(
    `INSERT INTO teams (name, slug) VALUES ($1, $1)
     ON CONFLICT (slug) DO UPDATE SET slug = EXCLUDED.slug
     RETURNING id`,
    [slug],
  );
  const teamId = rows[0].id as number;
  await ensureTeamDefaults(query, teamId);
  return { teamId, userId: null };
}

export const tenant = {
  fromRequest: (request: Request) => teamFor(request.headers.get("x-team")),
  fromPage: async () => teamFor((await headers()).get("x-team")),
};
