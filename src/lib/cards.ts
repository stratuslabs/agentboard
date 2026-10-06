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
