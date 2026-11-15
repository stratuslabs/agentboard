import { useEffect, useState } from "react";
import type { ViewCard } from "../components/ListView";

/**
 * Loading state for the list pages (Today, Assigned to me, Past Due). They
 * used to start from an empty list, so they said "No cards found" until the
 * cards arrived and kept saying it when the request failed (AB-156).
 */
export type ViewCardsState =
  | { status: "loading" }
  | { status: "ready"; cards: ViewCard[] }
  | { status: "failed" };

/**
 * GETs a JSON list. Never throws: a dropped connection, a non-OK answer, or
 * an answer that isn't a JSON array (a proxy's error page, a 200 with an error
 * object) is null, so a failure can't pass for an empty list.
 */
export async function fetchJsonList<T>(url: string): Promise<T[] | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const body: unknown = await res.json();
    return Array.isArray(body) ? (body as T[]) : null;
  } catch {
    return null;
  }
}

/**
 * The list's state after an answer. An OK answer is ready, empty or not. A
 * failure is an error, except when cards are already on screen: a refresh
 * after an edit that fails keeps them rather than swapping them for an error.
 */
export function settleViewCards(prev: ViewCardsState, next: ViewCard[] | null): ViewCardsState {
  if (next) return { status: "ready", cards: next };
  return prev.status === "ready" ? prev : { status: "failed" };
}

/**
 * Runs loads and hands each answer to `apply`, except one that a newer load
 * has superseded, so a slow first load can't land after a refresh and put
 * older cards (or an error) back on screen.
 */
export function viewCardsLoader(
  apply: (cards: ViewCard[] | null) => void,
  fetchCards: () => Promise<ViewCard[] | null>,
) {
  let latest = 0;
  return async () => {
    const id = ++latest;
    const next = await fetchCards();
    if (id === latest) apply(next);
  };
}

/**
 * Cards for a list of one member's cards (Assigned to me, Past Due), in one
 * request. With no member the list is empty without asking: the route answers
 * 400 without a member, and an "everyone" list would be wrong.
 */
export function memberViewFetcher(
  member: number | null,
  url: (memberId: number) => string,
  fetchList: typeof fetchJsonList = fetchJsonList,
) {
  return async (): Promise<ViewCard[] | null> =>
    member === null ? [] : fetchList<ViewCard>(url(member));
}

/**
 * Loads a list page's cards on mount. `reload` resolves once its answer is
 * applied, so Try again can show progress until then. `fetchCards` is read
 * once, on the first render.
 */
export function useViewCards(fetchCards: () => Promise<ViewCard[] | null>) {
  const [state, setState] = useState<ViewCardsState>({ status: "loading" });
  const [reload] = useState(() =>
    viewCardsLoader((next) => setState((prev) => settleViewCards(prev, next)), fetchCards),
  );
  useEffect(() => {
    reload();
  }, [reload]);
  return { state, cards: state.status === "ready" ? state.cards : [], reload };
}
