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

/**
 * The profile member the server confirms for this user and team, once a load
 * has succeeded: its saved value, or null when it has none. Never the local
 * cache, which everyone who signs in on this browser shares, across every
 * team; taking it for "me" showed the previous person's cards on Assigned to
 * me and Past Due (AB-162). A profile set in this session while the load was
 * in flight wins over the answer.
 *
 * @param {unknown} saved  the server's value for the profile key, undefined if it has none
 * @param {boolean} touched  whether the profile was set in this session
 * @param {number | null} local  the profile as set in this session
 * @returns {number | null}
 */
export function confirmedProfileMember(saved, touched, local) {
  if (touched) return local;
  return Number.isInteger(saved) && saved > 0 ? saved : null;
}
