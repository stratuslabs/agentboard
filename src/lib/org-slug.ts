import { slugify } from "./slug";
import { getConfig, orgPagesMounted } from "../configure";

/**
 * Top-level paths the app itself owns. An organization lives at
 * `/<orgSlug>/<productSlug>`, so an org whose slug is one of these would be
 * shadowed by the app's own route: an org slugged `c` would have every product
 * URL caught by the permanent card link `/c/<id>`.
 *
 * Keep this in step with the folders directly under `src/app` and
 * `src/app/(board)`.
 */
export const RESERVED_ORG_SLUGS: ReadonlySet<string> = new Set([
  "api",
  "assigned",
  "c",
  "login",
  "past-due",
  "settings",
  "today",
]);

/**
 * The reserved slugs that already have routes one level down, so an existing
 * org with one of these slugs cannot be reached at `/<slug>/<product>` at all.
 * Only these are moved by the startup migration; an existing org slugged
 * `today` still works and keeps its URLs.
 */
export const SHADOWED_ORG_SLUGS: readonly string[] = ["api", "c"];

/**
 * Whether a slug is one of the app's own paths: the core's, or one an app
 * that consumes it reserved with configure({ reservedOrgSlugs }).
 */
export function isReservedOrgSlug(slug: string): boolean {
  const lower = slug.toLowerCase();
  return RESERVED_ORG_SLUGS.has(lower) || (getConfig().reservedOrgSlugs ?? []).includes(lower);
}

/**
 * The slug for an organization name. A name that would land on a reserved
 * path gets `-org` appended, so an org called "C" is `/c-org/...`.
 */
export function orgSlugFromName(name: string): string {
  const slug = slugify(name);
  return isReservedOrgSlug(slug) ? `${slug}-org` : slug;
}

/**
 * The org page for an org slug, /<orgSlug>, or null when the org has none.
 *
 * An org kept on a slug the core reserved later (an existing `today` org keeps
 * its URLs) has no org page: /today is the Today page. This runs in the
 * browser, where configure() isn't loaded, so it checks only the core's own
 * list. Slugs the consuming app reserved are the server's call: the board
 * gets `org_page` from /api/products/by-slug and passes it on as the
 * KanbanBoard `orgPage` prop.
 */
/**
 * Whether /<slug> is that org's page, on the server: the app mounts org pages
 * and the slug isn't one of the app's own paths (the core's, or one the
 * consuming app reserved). /api/products/by-slug returns it as `org_page`.
 */
export function hasOrgPage(slug: string): boolean {
  return orgPagesMounted() && !isReservedOrgSlug(slug);
}

export function orgPageHref(slug: string): string | null {
  return RESERVED_ORG_SLUGS.has(slug.toLowerCase()) ? null : `/${slug}`;
}
