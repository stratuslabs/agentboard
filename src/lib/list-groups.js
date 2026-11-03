// Product groups on the Assigned to me, Today and Past Due lists (card 297),
// and which of them are collapsed. The collapsed state is one preference for
// all lists: { [listId]: groupKey[] }, so each list remembers its own.

/**
 * @typedef {{ product_id?: number, product_name: string, product_emoji: string, org_name?: string }} GroupableCard
 * @typedef {Record<string, string[]>} CollapsedGroups
 */

/**
 * Groups cards by product, in the order each product first appears. The key is
 * stable across renames ("product:<id>"). When two groups share a name (same
 * product name in two orgs), each carries `org` so the header can tell them apart.
 * @template {GroupableCard} T
 * @param {T[]} cards
 * @returns {{ key: string, emoji: string, name: string, org?: string, cards: T[] }[]}
 */
export function groupByProduct(cards) {
  /** @type {Map<string, { key: string, emoji: string, name: string, org?: string, orgName?: string, cards: T[] }>} */
  const groups = new Map();
  for (const card of cards) {
    const key = card.product_id != null ? `product:${card.product_id}` : `product:${card.product_emoji} ${card.product_name}`;
    let group = groups.get(key);
    if (!group) {
      group = { key, emoji: card.product_emoji, name: card.product_name, orgName: card.org_name, cards: [] };
      groups.set(key, group);
    }
    group.cards.push(card);
  }
  const list = [...groups.values()];
  /** @type {Map<string, number>} */
  const names = new Map();
  for (const g of list) names.set(g.name, (names.get(g.name) ?? 0) + 1);
  return list.map(({ orgName, ...g }) => ((names.get(g.name) ?? 0) > 1 && orgName ? { ...g, org: orgName } : g));
}

/**
 * The stored preference, or nothing collapsed when it isn't the right shape.
 * @param {unknown} value
 * @returns {CollapsedGroups}
 */
export function normalizeCollapsed(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  /** @type {CollapsedGroups} */
  const out = {};
  for (const [list, keys] of Object.entries(value)) {
    if (!Array.isArray(keys)) continue;
    const valid = [...new Set(keys.filter((k) => typeof k === "string"))];
    if (valid.length) out[list] = valid;
  }
  return out;
}

/**
 * @param {CollapsedGroups} state
 * @param {string} list
 * @param {string} key
 */
export function isCollapsed(state, list, key) {
  return Array.isArray(state[list]) && state[list].includes(key);
}

/**
 * A new state with one group flipped. Never changes its input; drops a list
 * entry once nothing in it is collapsed.
 * @param {CollapsedGroups} state
 * @param {string} list
 * @param {string} key
 * @returns {CollapsedGroups}
 */
export function toggleCollapsed(state, list, key) {
  const current = Array.isArray(state[list]) ? state[list] : [];
  const next = current.includes(key) ? current.filter((k) => k !== key) : [...current, key];
  const out = { ...state };
  if (next.length) out[list] = next; else delete out[list];
  return out;
}

/**
 * Apply early clicks, in order, on top of a state: each says whether the user
 * left that group collapsed. Used to replay clicks made before the stored
 * preference arrived onto the server's value. Recording the chosen state, not
 * a flip, keeps the user's choice when the local cache and the server disagree.
 * @param {CollapsedGroups} state
 * @param {Array<[string, string, boolean]>} choices  [list, key, collapsed]
 * @returns {CollapsedGroups}
 */
export function replayChoices(state, choices) {
  return choices.reduce(
    (acc, [list, key, collapsed]) => (isCollapsed(acc, list, key) === collapsed ? acc : toggleCollapsed(acc, list, key)),
    state,
  );
}

// Group by (card 298): each list can group by product (the default), by
// priority, or not at all. The choice is remembered per list, each under its
// own preference key, so changing one list never rewrites another's choice.

export const GROUPINGS = /** @type {const} */ (["product", "priority", "none"]);

/** @typedef {typeof GROUPINGS[number]} Grouping */

const PRIORITY_ORDER = ["urgent", "high", "medium", "low"];
const GROUPING_PREFIX = "agentboard-list-grouping:";

/**
 * A stored or requested grouping, or "product" when it isn't one we offer.
 * @param {unknown} value
 * @returns {Grouping}
 */
export function normalizeGrouping(value) {
  return GROUPINGS.includes(/** @type {any} */ (value)) ? /** @type {Grouping} */ (value) : "product";
}

/** The preference key one list's grouping is saved under. @param {string} list */
export function groupingPrefKey(list) {
  return GROUPING_PREFIX + list;
}

/**
 * Cards by priority, urgent first. A priority outside the usual four keeps its
 * own group after Low, and cards with none share a "No priority" group last,
 * so no card disappears. Order inside a group is the input order.
 * @template {{ priority?: string | null }} T
 * @param {T[]} cards
 */
function groupByPriority(cards) {
  /** @type {Map<string, T[]>} */
  const byPriority = new Map();
  for (const card of cards) {
    const p = typeof card.priority === "string" && card.priority ? card.priority : "";
    const list = byPriority.get(p);
    if (list) list.push(card); else byPriority.set(p, [card]);
  }
  const rank = (/** @type {string} */ p) => {
    const i = PRIORITY_ORDER.indexOf(p);
    return i >= 0 ? i : p ? PRIORITY_ORDER.length : PRIORITY_ORDER.length + 1;
  };
  return [...byPriority.entries()]
    .sort(([a], [b]) => rank(a) - rank(b))
    .map(([p, list]) => ({
      key: `priority:${p || "none"}`,
      emoji: "",
      name: p ? p.charAt(0).toUpperCase() + p.slice(1) : "No priority",
      priority: p || undefined,
      cards: list,
    }));
}

/**
 * Groups for a list under the chosen grouping. "none" gives one group marked
 * `flat`, which the list shows without a header.
 * @template {GroupableCard & { priority?: string | null }} T
 * @param {T[]} cards
 * @param {unknown} grouping
 * @returns {{ key: string, emoji: string, name: string, org?: string, priority?: string, flat?: boolean, cards: T[] }[]}
 */
export function groupCards(cards, grouping) {
  const g = normalizeGrouping(grouping);
  if (g === "priority") return groupByPriority(cards);
  if (g === "none") return cards.length ? [{ key: "all", emoji: "", name: "All cards", flat: true, cards: [...cards] }] : [];
  return groupByProduct(cards);
}

/**
 * The groupings to use once the stored preferences arrive. The server wins for
 * every list except those changed here since the page loaded (their keys are
 * in `touched`); a list with no valid stored choice gets the default.
 * @param {Record<string, Grouping>} local
 * @param {Record<string, unknown>} received
 * @param {Set<string>} touched
 * @returns {Record<string, Grouping>}
 */
export function mergeGroupings(local, received, touched) {
  /** @type {Record<string, Grouping>} */
  const out = {};
  for (const [list, value] of Object.entries(local)) {
    if (touched.has(groupingPrefKey(list))) out[list] = value;
  }
  for (const [key, value] of Object.entries(received)) {
    if (!key.startsWith(GROUPING_PREFIX) || touched.has(key)) continue;
    if (GROUPINGS.includes(/** @type {any} */ (value))) out[key.slice(GROUPING_PREFIX.length)] = /** @type {Grouping} */ (value);
  }
  return out;
}

/**
 * The local cache of groupings, or nothing when it isn't the right shape.
 * @param {unknown} value
 * @returns {Record<string, Grouping>}
 */
export function normalizeGroupings(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  /** @type {Record<string, Grouping>} */
  const out = {};
  for (const [list, g] of Object.entries(value)) {
    if (GROUPINGS.includes(/** @type {any} */ (g))) out[list] = /** @type {Grouping} */ (g);
  }
  return out;
}
