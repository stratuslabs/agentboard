// Loading the signed-in user's preferences. A load that didn't work (signed
// out, a 4xx/5xx, a dropped connection, an answer that isn't the preferences
// object) comes back as a failure, never as empty preferences. The provider
// mounts in the root layout, so its first load can run on /login before
// there is a session; taking that 401 for "nothing saved" opened profile setup
// for people who already had a profile, and Continue added a duplicate
// member (AB-152).

/**
 * GET /api/preferences.
 *
 * @param {typeof fetch} [fetchImpl]
 * @param {AbortSignal} [signal]
 * @returns {Promise<{ ok: true, prefs: Record<string, unknown> } | { ok: false }>}
 */
export async function loadPreferences(fetchImpl = fetch, signal) {
  try {
    const res = await fetchImpl("/api/preferences", { signal });
    if (!res.ok) return { ok: false };
    const prefs = await res.json();
    if (!prefs || typeof prefs !== "object" || Array.isArray(prefs)) return { ok: false };
    return { ok: true, prefs };
  } catch {
    return { ok: false };
  }
}

/**
 * Whether to ask the user to set up their profile: only when the server has
 * answered and has no profile for them. Before that, or after a failed load,
 * we don't know, and creating a member would duplicate theirs.
 *
 * @param {{ serverLoaded: boolean, profileMemberId: number | null }} state
 */
export function needsProfileSetup({ serverLoaded, profileMemberId }) {
  return serverLoaded && profileMemberId === null;
}
