// Saving a team setting from the Settings page. The UI shows "Saved" only when
// the server says it stored the value; anything else (a 4xx/5xx, a body that
// isn't JSON, a dropped connection) comes back as a message to show, so a
// failed save is never reported as a success.

/**
 * PATCH /api/settings with `{ key, value }`.
 *
 * @param {string} key
 * @param {unknown} value
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<{ ok: true } | { ok: false, message: string }>}
 */
export async function saveSetting(key, value, fetchImpl = fetch) {
  let res;
  try {
    res = await fetchImpl("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value }),
    });
  } catch {
    return { ok: false, message: "Couldn't reach the server. Your changes weren't saved." };
  }
  if (res.ok) return { ok: true };

  let detail = "";
  try {
    const data = await res.json();
    if (data && typeof data.error === "string") detail = data.error.trim();
  } catch {
    // Not JSON (a proxy error page, say): the status is all we have.
  }
  return { ok: false, message: `Save failed (${res.status})${detail ? `: ${detail}` : ""}. Your changes weren't saved.` };
}
