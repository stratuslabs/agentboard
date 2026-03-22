"use client";

interface Card {
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

const PRIORITY_COLORS: Record<string, string> = {
  urgent: "bg-priority-urgent",
  high: "bg-priority-high",
  medium: "bg-priority-medium",
  low: "bg-priority-low",
};

interface KanbanCardProps {
  card: Card;
  onClick: () => void;
}

function parseDateStr(dateStr: string): Date {
  // Handle both "YYYY-MM-DD" and full ISO "YYYY-MM-DDT00:00:00.000Z"
  const dateOnly = dateStr.slice(0, 10);
  return new Date(dateOnly + "T00:00:00");
}

function formatDueDate(dateStr: string): string {
  const d = parseDateStr(dateStr);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function getDueDateStatus(dateStr: string): "overdue" | "today" | "future" {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = parseDateStr(dateStr);
  due.setHours(0, 0, 0, 0);
  if (due.getTime() < today.getTime()) return "overdue";
  if (due.getTime() === today.getTime()) return "today";
  return "future";
}

export default function KanbanCard({ card, onClick }: KanbanCardProps) {
  const labelList = card.labels
    ? card.labels
        .split(",")
        .map((l) => l.trim())
        .filter(Boolean)
    : [];

  const displayName = card.assignee_name || card.assignee;
  const displayColor = card.assignee_color || null;
  const isAgent = card.assignee_type === "agent";

  const dueDateStatus = card.due_date ? getDueDateStatus(card.due_date) : null;
  const dueDateColor = dueDateStatus === "overdue" ? "text-red-400" : dueDateStatus === "today" ? "text-yellow-400" : "text-gray-500";

  return (
    <div
      onClick={onClick}
      className="p-3 bg-surface-800 rounded-lg border border-surface-600 cursor-pointer card-hover"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-gray-200 leading-snug flex-1">
          {card.title}
        </p>
        <div className="flex items-center gap-1.5 shrink-0">
          {(card.github_issue_url || card.github_pr_url) && (
            <svg
              className="w-3.5 h-3.5 text-gray-500"
              fill="currentColor"
              viewBox="0 0 24 24"
            >
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
            </svg>
          )}
        </div>
      </div>

      {/* Labels */}
      {labelList.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {labelList.map((label) => (
            <span
              key={label}
              className="px-1.5 py-0.5 text-[10px] font-medium bg-surface-600 text-gray-300 rounded"
            >
              {label}
            </span>
          ))}
        </div>
      )}

      {/* Bottom row: assignee + priority */}
      <div className="flex items-center justify-between mt-2.5">
        {displayName ? (
          <div className="flex items-center gap-1.5" title={displayName}>
            {displayColor ? (
              <div
                className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-semibold text-white"
                style={{ backgroundColor: displayColor }}
              >
                {displayName.charAt(0).toUpperCase()}
              </div>
            ) : (
              <div className="w-6 h-6 rounded-full bg-surface-600 flex items-center justify-center text-[10px] font-semibold text-gray-400 uppercase">
                {displayName.charAt(0)}
              </div>
            )}
            {isAgent && <span className="text-[10px]">{"\u{1F916}"}</span>}
          </div>
        ) : (
          <div />
        )}
        <div className="flex items-center gap-2">
          {card.due_date && (
            <span className={`flex items-center gap-1 text-[11px] ${dueDateColor}`} title={`Due: ${card.due_date}`}>
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              {formatDueDate(card.due_date)}
            </span>
          )}
          <div
            className={`w-2 h-2 rounded-full ${PRIORITY_COLORS[card.priority] || PRIORITY_COLORS.medium}`}
            title={card.priority}
          />
        </div>
      </div>
    </div>
  );
}
