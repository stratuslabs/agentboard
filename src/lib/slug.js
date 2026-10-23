// Plain JavaScript with JSDoc types so `node --test` can import it on the
// Node version CI uses, without a build step.

/**
 * Lowercase, with every run of other characters turned into one hyphen.
 * @param {string} text
 * @returns {string}
 */
export function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
