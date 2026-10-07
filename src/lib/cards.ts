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

export function cardLink(cardId: number): string {
  const url = new URL(window.location.href);
  url.searchParams.set("card", String(cardId));
  url.searchParams.delete("view");
  return url.toString();
}
