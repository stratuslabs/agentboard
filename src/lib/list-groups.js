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
