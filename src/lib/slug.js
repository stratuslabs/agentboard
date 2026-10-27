// Plain JavaScript with JSDoc types so `node --test` can import it on the
// Node version CI uses, without a build step.
//
// One slug rule for orgs, products, boards and columns:
//
// - A name makes its slug with slugify.
// - Nothing is added whose name makes a slug a sibling already holds, or a
//   name a sibling already has. That's a 409 naming the holder, not a
//   duplicate, a quiet suffix or a database error.
// - Renaming an org, product or board keeps its slug: URLs and agent configs
//   point at it. A column's slug follows its name instead (column-slug.js),
//   because `agentboard status <id> todo` means "the column called Todo".

const APOSTROPHES = /['‘’ʼ`]/g;

/**
 * Lowercase, apostrophes dropped, and every other run of characters that
 * aren't letters or digits turned into one hyphen: "Floyd's X" is floyds-x.
 * @param {string} text
 * @returns {string}
 */
export function slugify(text) {
  return legacySlugify(text.replace(APOSTROPHES, ""));
}

/**
 * The rule before apostrophes were dropped ("Floyd's X" was floyd-s-x).
 * Slugs it made are still in use, so they still count as matching their name.
 * @param {string} text
 * @returns {string}
 */
export function legacySlugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** @typedef {{ id: number | string, name: string, slug: string }} SlugRow */
/** @typedef {{ kind: string, scope: string }} SlugScope e.g. { kind: "board", scope: "in this product" } */
/**
 * @typedef {{ ok: true, name: string, slug: string }
 *   | { ok: false, status: 400 | 409, error: string }} SlugPlan
 */

const capitalized = (/** @type {string} */ s) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Check a name for adding (selfId null) or renaming an org, product or board,
 * and work out its slug: the name's on add, the one it has on rename.
 *
 * @param {SlugScope} what
 * @param {unknown} rawName
 * @param {SlugRow[]} siblings everything in the same scope; may include itself
 * @param {number | string | null} selfId
 * @param {(name: string) => string} [makeSlug] slugify, or the org rule
 * @returns {SlugPlan}
 */
export function planSlugName(what, rawName, siblings, selfId, makeSlug = slugify) {
  const Kind = capitalized(what.kind);
  if (typeof rawName !== "string" || !rawName.trim()) {
    return { ok: false, status: 400, error: `${Kind} name can't be empty` };
  }
  const name = rawName.trim();
  const slug = makeSlug(name);
  if (!slug) {
    return { ok: false, status: 400, error: `${Kind} name needs at least one letter or number` };
  }
  const self = selfId === null ? undefined : siblings.find((s) => String(s.id) === String(selfId));
  const others = siblings.filter((s) => s !== self);
  const conflict = slugConflict(what, name, slug, others);
  if (conflict) return conflict;
  return { ok: true, name, slug: self ? self.slug : slug };
}

/**
 * The 409 for a name that makes a slug, or matches a name, one of `others`
 * already has. Null when there's no clash.
 * @param {SlugScope} what
 * @param {string} name
 * @param {string} slug what the name makes
 * @param {SlugRow[]} others
 * @returns {{ ok: false, status: 409, error: string } | null}
 */
export function slugConflict(what, name, slug, others) {
  const made = new Set([slug, slugify(name), legacySlugify(name)].filter(Boolean));
  for (const s of made) {
    const taken = slugTaken(what, s, others, "name");
    if (taken) return taken;
  }
  const namesake = others.find((o) => made.has(slugify(o.name)) || made.has(legacySlugify(o.name)));
  if (namesake) {
    return {
      ok: false,
      status: 409,
      error: `Another ${what.kind} ${what.scope} is already called ${namesake.name} (slug '${namesake.slug}'). Pick a different name.`,
    };
  }
  return null;
}

/**
 * The 409 for a slug, as given, that one of `others` already holds. Names
 * aren't looked at: this is for a slug someone asked for explicitly.
 * @param {SlugScope} what
 * @param {string} slug
 * @param {SlugRow[]} others
 * @param {"slug" | "name"} [pick] what the error asks for a different one of
 * @returns {{ ok: false, status: 409, error: string } | null}
 */
export function slugTaken(what, slug, others, pick = "slug") {
  const holder = others.find((o) => o.slug === slug);
  if (!holder) return null;
  return {
    ok: false,
    status: 409,
    error: `Another ${what.kind} ${what.scope} already uses the slug '${holder.slug}' (${holder.name}). Pick a different ${pick}.`,
  };
}

/**
 * Whether a database error is a unique-constraint violation, for the race
 * where another request takes the slug between the check and the write.
 * @param {unknown} err
 */
export function isUniqueViolation(err) {
  return Boolean(err && typeof err === "object" && /** @type {any} */ (err).code === "23505");
}
