// Where to go after signing in. When a signed-out browser asks for a page, the
// middleware redirects to /login?next=<path>, and the login page sends it back
// there once the password is accepted. `next` arrives in a URL anyone can
// craft, so it is only followed when it is a path on this site: otherwise a
// link to our own login page could hand a fresh session off to another domain.

const BASE = "http://agentboard.invalid";

/**
 * The same-site path `value` names, as path + query, or "/" when it names
 * anything else: another origin, a protocol-relative or backslash path, a
 * non-string, the login page itself or an API route.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function safeNextPath(value) {
  if (typeof value !== "string") return "/";
  // Only a path that starts with exactly one "/" is a path on this site.
  // Browsers read "\" as "/", and the URL parser drops tabs and newlines, so
  // "/\evil.test" and "/<tab>/evil.test" are both //evil.test to them.
  if (!value.startsWith("/") || /[\\\s]/.test(value)) return "/";

  let url;
  try {
    url = new URL(value, BASE);
  } catch {
    return "/";
  }
  if (url.origin !== BASE) return "/";

  // Check the resolved path too: dot segments can collapse "/.//evil.test"
  // into "//evil.test", which router.push would treat as another host.
  const path = url.pathname + url.search;
  if (path.startsWith("//")) return "/";
  if (url.pathname === "/login" || url.pathname === "/api" || url.pathname.startsWith("/api/")) return "/";
  return path;
}

/**
 * The login URL for a signed-out request to `pathname` + `search`. Home and
 * anything safeNextPath would refuse get a plain /login.
 *
 * @param {string} pathname
 * @param {string} search
 * @returns {string}
 */
export function loginPath(pathname, search) {
  const next = safeNextPath(pathname + (search || ""));
  return next === "/" ? "/login" : `/login?next=${encodeURIComponent(next)}`;
}
