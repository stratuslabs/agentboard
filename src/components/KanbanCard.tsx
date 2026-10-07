"use client";

import { Bot, Calendar, CircleDot, GitPullRequest } from "lucide-react";
import { Avatar, Chip, PriorityDot, cx } from "./ui";
import { type Card, DUE_TEXT, displayAssignee, formatDueDate, getDueDateStatus, githubRef, parseLabels } from "@/lib/cards";

interface KanbanCardProps {
  card: Card;
  onClick: () => void;
  selected?: boolean;
}

export default function KanbanCard({ card, onClick, selected }: KanbanCardProps) {
  const labelList = parseLabels(card.labels);
  const displayName = displayAssignee(card);
  const isAgent = card.assignee_type === "agent";
  const dueStatus = card.due_date ? getDueDateStatus(card.due_date) : null;
  const prRef = githubRef(card.github_pr_url);
  const issueRef = githubRef(card.github_issue_url);
  // A link whose URL carries no number still deserves a mark on the card.
  const hasUnnumberedLink = (card.github_pr_url && !prRef) || (card.github_issue_url && !issueRef);

  return (
    <div
      onClick={onClick}
      className={cx(
        "card-hover flex cursor-pointer flex-col gap-2.5 rounded-lg border bg-surface-2 p-3",
        selected ? "border-text-2 bg-surface-3" : "border-border-strong",
      )}
    >
      <p className="text-[13.5px] leading-[1.45] text-text-1">{card.title}</p>

      {labelList.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {labelList.map((label) => (
            <Chip key={label}>{label}</Chip>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        {displayName && (
          <span className="flex items-center gap-2" title={displayName}>
            <Avatar name={displayName} color={card.assignee_color} size={20} />
            {isAgent && <Bot aria-label="Agent" className="h-[13px] w-[13px] text-silver" />}
          </span>
        )}
        <span className="flex-1" />
        {prRef && (
          <span className="flex items-center gap-[3px] font-mono text-[11px] text-text-3" title={card.github_pr_url ?? undefined}>
            <GitPullRequest className="h-[11px] w-[11px]" />{prRef}
          </span>
        )}
        {issueRef && (
          <span className="flex items-center gap-[3px] font-mono text-[11px] text-text-3" title={card.github_issue_url ?? undefined}>
            <CircleDot className="h-[11px] w-[11px]" />{issueRef}
          </span>
        )}
        {hasUnnumberedLink && <GitPullRequest aria-label="GitHub link" className="h-[11px] w-[11px] text-text-3" />}
        {card.due_date && dueStatus && (
          <span className={cx("flex items-center gap-1 font-mono text-[11px]", DUE_TEXT[dueStatus])} title={`Due: ${card.due_date.slice(0, 10)}`}>
            <Calendar className="h-[11px] w-[11px]" />
            {formatDueDate(card.due_date)}
          </span>
        )}
        <PriorityDot priority={card.priority} />
      </div>
    </div>
  );
}
