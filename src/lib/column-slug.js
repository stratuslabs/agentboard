// A column's slug follows its name. The CLI moves cards by slug
// (`agentboard status <id> todo`), so a column renamed from "Todo" to
// "Can't replicate" has to stop answering to `todo`. Otherwise cards land in a
// column whose meaning changed under them.
//
// Products and boards are different: their slugs are addresses in URLs and
// agent configs, and #25 keeps those stable. A column slug names what the
// column means, so it moves with the name.
//
// Plain JavaScript with JSDoc types so `node --test` can run it on the Node
// version CI uses, without a build step.

import { legacySlugify, slugConflict, slugify } from "./slug.js";

/** @typedef {{ id: number, name: string, slug: string }} ColumnRef */

/** How a column clash is worded: "Another column on this board ...". */
export const COLUMN = { kind: "column", scope: "on this board" };

/**
 * True when the slug is what the name makes, or made before apostrophes were
 * dropped, or either with a `-N` suffix (how the migration resolves two
 * columns with the same name).
 * @param {string} slug
 * @param {string} name
 */
export function columnSlugMatchesName(slug, name) {
  // A slug made before apostrophes were dropped (can-t-replicate) still
  // matches, so the startup repair doesn't move columns agents already use.
  return [slugify(name), legacySlugify(name)].some((base) => {
    if (!base) return false;
    if (slug === base) return true;
    return slug.startsWith(`${base}-`) && /^\d+$/.test(slug.slice(base.length + 1));
  });
}

/**
 * Work out the name and slug for renaming one column on a board.
 * A slug another column already holds is a conflict, not something to share
 * or quietly suffix: the caller picks another name.
 * @param {ColumnRef[]} boardColumns every column on the board, including this one
 * @param {number} columnId
 * @param {unknown} rawName
 * @returns {{ ok: true, name: string, slug: string } | { ok: false, status: 400 | 409, error: string }}
 */
export function planColumnRename(boardColumns, columnId, rawName) {
  if (typeof rawName !== "string" || !rawName.trim()) {
    return { ok: false, status: 400, error: "Column name can't be empty" };
  }
  const name = rawName.trim();
  const slug = slugify(name);
  if (!slug) {
    return { ok: false, status: 400, error: "Column name needs at least one letter or number" };
  }
  const self = boardColumns.find((c) => Number(c.id) === Number(columnId));
  // Keep a suffixed slug when the name still makes the same base: renaming
  // "Review" to "REVIEW" shouldn't move `review-2` anywhere.
  if (self && columnSlugMatchesName(self.slug, name)) {
    return { ok: true, name, slug: self.slug };
  }
  const others = boardColumns.filter((c) => Number(c.id) !== Number(columnId));
  const conflict = slugConflict(COLUMN, name, slug, others);
  if (conflict) return conflict;
  return { ok: true, name, slug };
}

/**
 * One-time repair for columns renamed before slugs followed names. Returns the
 * slug changes to apply, in order; applying them one by one never breaks
 * UNIQUE(board_id, slug). Running it again on the result plans nothing.
 * @param {ColumnRef[]} boardColumns
 * @returns {{ id: number, from: string, to: string }[]}
 */
export function planColumnReslug(boardColumns) {
  const slugs = new Map(boardColumns.map((c) => [c.id, c.slug]));
  const taken = (slug, id) => [...slugs].some(([other, s]) => other !== id && s === slug);
  /** @type {{ id: number, from: string, to: string }[]} */
  const plan = [];
  const move = (c, to) => {
    plan.push({ id: c.id, from: slugs.get(c.id), to });
    slugs.set(c.id, to);
  };

  // First the columns whose slug means something else. Moving them frees
  // slugs like `todo` for the columns that are actually named that.
  for (const c of boardColumns) {
    const base = slugify(c.name);
    if (!base || columnSlugMatchesName(c.slug, c.name)) continue;
    let to = base;
    for (let n = 2; taken(to, c.id); n++) to = `${base}-${n}`;
    move(c, to);
  }
  // Then suffixed columns whose plain slug is now free. A plain slug made
  // before apostrophes were dropped (can-t-replicate) stays: agents use it.
  for (const c of boardColumns) {
    const current = slugs.get(c.id);
    for (const base of [slugify(c.name), legacySlugify(c.name)]) {
      if (!base || current === base || !current.startsWith(`${base}-`)) continue;
      if (!/^\d+$/.test(current.slice(base.length + 1))) continue;
      if (!taken(base, c.id)) move(c, base);
      break;
    }
  }
  return plan;
}
