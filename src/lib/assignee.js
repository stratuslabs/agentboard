// A card has two assignee fields: assignee_id, the team member it's filed
// under, and assignee, free text for someone who isn't a member. Writes used
// to set them independently, so an update could change one and leave the
// other naming somebody else: card 699 read assignee "Nova" with assignee_id
// pointing at Blair (card 838). Every card write now settles both together
// here, so at most one of them is ever set.
//
// Plain JavaScript with JSDoc types so `node --test` can run it without a
// build step.

/**
 * What a card write stores for its assignee, or null when the body doesn't
 * mention it.
 *
 * - A member id (already checked against the team) is stored with no text.
 * - A name that matches a member, any case, is stored as that member.
 * - A name that matches nobody is stored as text, with no member.
 * - An empty name, or a null id without a name, unassigns both.
 *
 * @param {{ assignee?: string | null, assignee_id?: unknown }} body text fields already checked by checkCardText
 * @param {(name: string) => Promise<number | null>} memberIdByName
 * @returns {Promise<{ assignee_id: any, assignee: string | null } | null>}
 */
export async function settleAssignee(body, memberIdByName) {
  const { assignee, assignee_id } = body;
  if (assignee_id !== undefined && assignee_id !== null) {
    return { assignee_id, assignee: null };
  }
  if (assignee === undefined && assignee_id === undefined) return null;
  const name = typeof assignee === "string" ? assignee.trim() : "";
  if (!name) return { assignee_id: null, assignee: null };
  const id = await memberIdByName(name);
  return id === null ? { assignee_id: null, assignee: name } : { assignee_id: id, assignee: null };
}
