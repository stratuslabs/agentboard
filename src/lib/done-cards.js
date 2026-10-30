// Done cards on list views (card 206). A card is Done when its column is named
// Done, in any case. The server views use the same rule (LOWER(col.name) = 'done').

/** True when a column name means Done. */
export function isDoneColumn(name) {
  return typeof name === "string" && name.trim().toLowerCase() === "done";
}

/**
 * The cards to show when Done cards may be hidden, and how many were hidden.
 * Keeps the order; never changes the input.
 */
export function withoutDone(cards, hide) {
  if (!hide) return { cards, hidden: 0 };
  const shown = cards.filter((card) => !isDoneColumn(card.column_name));
  return { cards: shown, hidden: cards.length - shown.length };
}
