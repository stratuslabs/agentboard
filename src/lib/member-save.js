// Saving a member's name or colour from Settings > Members. The editor closes
// only when the server says it stored the change; anything else (a 409 because
// another agent already has that name, another 4xx/5xx, a body that isn't
// JSON, a dropped connection) comes back as a message to show, so a failed
// rename is never silently dropped.

/**
 * PATCH /api/members/:id with the fields given in `changes`. A field left
 * undefined isn't sent, so the server keeps its current value.
 *
 * @param {number} id
 * @param {{ name?: string, color?: string }} changes
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<{ ok: true, member: unknown } | { ok: false, message: string }>}
 */
export async function saveMember(id, changes, fetchImpl = fetch) {
  let res;
  try {
    res = await fetchImpl(`/api/members/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: changes.name, color: changes.color }),
    });
  } catch {
    return { ok: false, message: "Couldn't reach the server. Your changes weren't saved." };
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    // Not JSON (a proxy error page, say): the status is all we have.
  }
  if (res.ok) return { ok: true, member: data };

  const detail = data && typeof data.error === "string" ? data.error.trim() : "";
  return { ok: false, message: detail || `Save failed (${res.status}). Your changes weren't saved.` };
}
