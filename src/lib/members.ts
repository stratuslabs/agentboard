import { sql } from "./sql";

const AGENT_COLORS = ['#EF4444','#F97316','#EAB308','#22C55E','#06B6D4','#3B82F6','#8B5CF6','#EC4899','#6B7280'];

/**
 * The team's agent member with this name, any case, registered on first use.
 * Cards created or edited with an `X-Agent-Name` header are attributed to it.
 *
 * One statement rather than a look then an insert: two first requests from a
 * new agent at the same moment would otherwise both insert. The conflict
 * target carries the agent-only index's predicate, so a header name that
 * matches a person's display name registers an agent rather than filing the
 * work under that person (see agent-names.js).
 */
export async function resolveAgentMember(teamId: number, agentName: string): Promise<number> {
  const color = AGENT_COLORS[Math.floor(Math.random() * AGENT_COLORS.length)];
  const { rows } = await sql`
    INSERT INTO members (team_id, name, type, color)
    VALUES (${teamId}, ${agentName}, 'agent', ${color})
    ON CONFLICT (team_id, LOWER(name)) WHERE type = 'agent'
      DO UPDATE SET name = members.name
    RETURNING id
  `;
  return rows[0].id;
}

/** The team's member with this name, any case, or null. */
export async function memberIdByName(teamId: number, name: string): Promise<number | null> {
  const { rows } = await sql`
    SELECT id FROM members WHERE team_id = ${teamId} AND LOWER(name) = LOWER(${name}) LIMIT 1
  `;
  return rows.length > 0 ? rows[0].id : null;
}
