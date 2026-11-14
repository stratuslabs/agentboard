// Loading the team's settings for the Settings page. A load that didn't work
// (a dropped connection, a 4xx/5xx, an answer that isn't the settings object)
// comes back as a failure, never as empty settings: a section that took a
// failure for "nothing saved yet" would show the built-in defaults, and Save
// would then overwrite the team's real settings with them (AB-146).

/**
 * GET /api/settings.
 *
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<{ ok: true, settings: Record<string, unknown> } | { ok: false }>}
 */
export async function loadSettings(fetchImpl = fetch) {
  try {
    const res = await fetchImpl("/api/settings");
    if (!res.ok) return { ok: false };
    const settings = await res.json();
    if (!settings || typeof settings !== "object" || Array.isArray(settings)) return { ok: false };
    return { ok: true, settings };
  } catch {
    return { ok: false };
  }
}
