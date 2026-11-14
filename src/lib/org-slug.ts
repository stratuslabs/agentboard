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
 * Whether /<slug> is that org's page, on the server: the app mounts org pages
 * and the slug isn't one of the app's own paths (the core's, or one the
 * consuming app reserved). /api/products/by-slug returns it as `org_page`.
 */
export function hasOrgPage(slug: string): boolean {
  return orgPagesMounted() && !isReservedOrgSlug(slug);
}

/**
 * Add `org_page` to a card or a list of cards that carry `org_slug`, for the
 * cross-product views (Today, Assigned, Past due): a card page opened from one
 * links its org crumb only when the org has a page. Anything without an org
 * slug is returned unchanged.
 */
export function withOrgPage<T>(data: T): T {
  const add = (row: unknown) =>
    row && typeof row === "object" && typeof (row as { org_slug?: unknown }).org_slug === "string"
      ? { ...row, org_page: hasOrgPage((row as { org_slug: string }).org_slug) }
      : row;
  return (Array.isArray(data) ? data.map(add) : add(data)) as T;
}

/**
 * The org page for an org slug, /<orgSlug>, or null when the org has none.
 *
 * An org kept on a slug the core reserved later (an existing `today` org keeps
 * its URLs) has no org page: /today is the Today page. This runs in the
 * browser, where configure() isn't loaded, so it checks only the core's own
 * list. Slugs the consuming app reserved are the server's call: it sends
 * `org_page` (from /api/products/by-slug and the card views), and the
 * breadcrumbs go through orgCrumbHref.
 */
export function orgPageHref(slug: string): string | null {
  return RESERVED_ORG_SLUGS.has(slug.toLowerCase()) ? null : `/${slug}`;
}

/**
 * Where the org name in a breadcrumb links: the org page when the server said
 * the org has one (`org_page`), else nowhere. The board and the card page both
 * use it, so the org crumb works the same in both.
 */
export function orgCrumbHref(slug: string | null | undefined, orgPage: boolean | undefined): string | null {
  return orgPage === true && slug ? orgPageHref(slug) : null;
}
