/**
 * Client-side card shapes and the small formatting rules every view shares.
 * Kept free of server imports so any component can use it.
 */

export interface Card {
  id: number;
  column_id: number;
  title: string;
  description: string;
  assignee: string | null;
  assignee_id: number | null;
  assignee_name: string | null;
  assignee_type: string | null;
  assignee_color: string | null;
  priority: string;
  labels: string;
  github_issue_url: string | null;
  github_pr_url: string | null;
  due_date: string | null;
  position: number;
  created_at: string;
  updated_at: string;
  /** Sub-task counts, from the board and card endpoints. Absent on older servers. */
  subtask_total?: number;
  subtask_done?: number;
  /** The card's number within its product, the 142 in AB-142. Null until the product has a key. */
  number?: number | null;
  /** The readable key, AB-142, when the endpoint already joined the product. */
  key?: string | null;
  /** The key of the product the card lives in, from endpoints that span products. */
  product_key?: string | null;
}

type CardRef = Pick<Card, "id"> & Partial<Pick<Card, "number" | "key" | "product_key">>;

/**
 * The card's readable key, AB-142, or null when it has none: a product
 * without a key yet, or an older server that sends no number.
 *
 * A key the server already put on the card wins. Otherwise it is built from
 * the card's own product key, which cross-product views send, and then from
 * `productKey`, the key of the board the card is shown on.
 */
export function cardKey(card: CardRef, productKey?: string | null): string | null {
  if (card.key) return card.key;
  const prefix = card.product_key || productKey;
  return prefix && card.number ? `${prefix}-${card.number}` : null;
}

/** What the UI calls a card: its key, or `#<id>` without one. */
export function cardLabel(card: CardRef, productKey?: string | null): string {
  return cardKey(card, productKey) ?? `#${card.id}`;
}

/** The tab title for an open card, "AB-142 Fix login", or undefined when none is open. */
export function cardTitle(
  card: (CardRef & Pick<Card, "title">) | null | undefined,
  productKey?: string | null,
): string | undefined {
  if (!card) return undefined;
  const key = cardKey(card, productKey);
  return key ? `${key} ${card.title}` : card.title;
}

export interface Member {
  id: number;
  name: string;
  type: string;
  color: string;
}

export interface Column {
  id: number;
  board_id: number;
  name: string;
  slug?: string;
  position?: number;
  color: string;
}

export const PRIORITIES = ["urgent", "high", "medium", "low"] as const;

export function priorityLabel(p: string): string {
  return p.charAt(0).toUpperCase() + p.slice(1);
}

export function parseLabels(labels: string | null | undefined): string[] {
  return labels ? labels.split(",").map((l) => l.trim()).filter(Boolean) : [];
}

/** Accepts both "YYYY-MM-DD" and a full ISO timestamp, read as a local date. */
export function parseDateStr(dateStr: string): Date {
  return new Date(dateStr.slice(0, 10) + "T00:00:00");
}

export function formatDueDate(dateStr: string): string {
  return parseDateStr(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export type DueStatus = "overdue" | "today" | "future";

export function getDueDateStatus(dateStr: string): DueStatus {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = parseDateStr(dateStr);
  if (due.getTime() < today.getTime()) return "overdue";
  if (due.getTime() === today.getTime()) return "today";
  return "future";
}

export const DUE_TEXT: Record<DueStatus, string> = {
  overdue: "text-danger",
  today: "text-warn",
  future: "text-text-3",
};

/** "#214" from a GitHub issue or pull request URL, or null if the URL has no number. */
export function githubRef(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(/\/(?:pull|issues)\/(\d+)/);
  return m ? `#${m[1]}` : null;
}

export function displayAssignee(card: Pick<Card, "assignee_name" | "assignee">): string | null {
  return card.assignee_name || card.assignee || null;
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** "just now", "5m ago", "2h ago", "3d ago", then a date. */
export function formatRelative(iso: string, now: Date = new Date()): string {
  const diff = (now.getTime() - new Date(iso).getTime()) / 1000;
  if (diff < 45) return "just now";
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  if (diff < 7 * 86400) return `${Math.round(diff / 86400)}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** "today", "tomorrow", "in 3 days", "2 days ago" for a due date. */
export function describeDue(dateStr: string): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((parseDateStr(dateStr).getTime() - today.getTime()) / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}

/**
 * The open card lives in the URL as `?card=<id>`, with `&view=full` for the
 * expanded page, so a card can be linked to and survives a refresh. History is
 * replaced rather than pushed: stepping through cards should not fill the back
 * button with every one of them.
 */
export function readCardParam(): { cardId: number | null; full: boolean } {
  if (typeof window === "undefined") return { cardId: null, full: false };
  const sp = new URLSearchParams(window.location.search);
  const id = Number(sp.get("card"));
  return { cardId: Number.isInteger(id) && id > 0 ? id : null, full: sp.get("view") === "full" };
}

export function writeCardParam(cardId: number | null, full = false): void {
  const url = new URL(window.location.href);
  if (cardId) url.searchParams.set("card", String(cardId));
  else url.searchParams.delete("card");
  if (cardId && full) url.searchParams.set("view", "full");
  else url.searchParams.delete("view");
  window.history.replaceState(window.history.state, "", url.toString());
}

/**
 * The card's permanent URL, `/c/AB-142`, or `/c/<id>` for a card without a
 * key. It resolves to wherever the card lives when it's opened, so it keeps
 * working after the card moves board or the product is renamed, and doesn't
 * depend on the page it was copied from. A key that later changes, because
 * the product's key was edited or the card moved product, still resolves:
 * old keys are kept.
 */
export function cardLink(card: CardRef, productKey?: string | null): string {
  const ref = cardKey(card, productKey) ?? String(card.id);
  return new URL(`/c/${encodeURIComponent(ref)}`, window.location.origin).toString();
}
