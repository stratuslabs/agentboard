"use client";

import { useState } from "react";
import CardModal from "./CardModal";

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

interface ViewCard extends Card {
  org_name: string;
  product_name: string;
  product_emoji: string;
  board_name: string;
  column_name: string;
  column_color: string;
}

const PRIORITY_COLORS: Record<string, string> = {
  urgent: "bg-priority-urgent",
  high: "bg-priority-high",
  medium: "bg-priority-medium",
  low: "bg-priority-low",
};

function parseDateStr(dateStr: string): Date {
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

interface ListViewProps {
  cards: ViewCard[];
  title: string;
  icon: string;
  onRefresh: () => void;
  onBack?: () => void;
}

export default function ListView({ cards, title, icon, onRefresh, onBack }: ListViewProps) {
  const [modalCard, setModalCard] = useState<ViewCard | null>(null);

  // Group cards by product
  const grouped = cards.reduce<Record<string, ViewCard[]>>((acc, card) => {
    const key = `${card.product_emoji} ${card.product_name}`;
    if (!acc[key]) acc[key] = [];
    acc[key].push(card);
    return acc;
  }, {});

  function handleCardUpdate(updated: Card) {
    setModalCard((prev) => prev ? { ...prev, ...updated } : null);
    onRefresh();
  }

  function handleCardDelete() {
    setModalCard(null);
    onRefresh();
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="border-b border-surface-600 px-6 py-4">
        <h1 className="text-lg font-semibold text-white flex items-center gap-2">
          {onBack && (
            <button onClick={onBack} className="w-7 h-7 -ml-1 mr-1 rounded-lg hover:bg-surface-600 flex items-center justify-center text-gray-400 hover:text-white transition-colors shrink-0" title="Back">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            </button>
          )}
          <span>{icon}</span>
          {title}
          <span className="text-sm font-normal text-gray-500 ml-1">
            {cards.length} {cards.length === 1 ? "card" : "cards"}
          </span>
        </h1>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {cards.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="w-16 h-16 rounded-2xl bg-surface-800 border border-surface-600 flex items-center justify-center mx-auto mb-4 text-2xl">
              {icon}
            </div>
            <h2 className="text-lg font-medium text-gray-400 mb-1">No cards found</h2>
            <p className="text-sm text-gray-600">
              {title === "Today" ? "No cards are due today." : "No cards are assigned to you."}
            </p>
          </div>
        ) : (
          <div className="space-y-6 max-w-4xl">
            {Object.entries(grouped).map(([productKey, productCards]) => (
              <div key={productKey}>
                <h2 className="text-sm font-semibold text-gray-300 mb-2">{productKey}</h2>
                <div className="space-y-1">
                  {productCards.map((card) => {
                    const dueDateStatus = card.due_date ? getDueDateStatus(card.due_date) : null;
                    const dueDateColor = dueDateStatus === "overdue" ? "text-red-400" : dueDateStatus === "today" ? "text-yellow-400" : "text-gray-500";
                    const displayName = card.assignee_name || card.assignee;
                    const displayColor = card.assignee_color || null;

                    return (
                      <button
                        key={card.id}
                        onClick={() => setModalCard(card)}
                        className="w-full flex items-center gap-3 px-3 py-2.5 bg-surface-800 border border-surface-600 rounded-lg hover:bg-surface-700 transition-colors text-left"
                      >
                        {/* Priority dot */}
                        <div
                          className={`w-2 h-2 rounded-full shrink-0 ${PRIORITY_COLORS[card.priority] || PRIORITY_COLORS.medium}`}
                          title={card.priority}
                        />

                        {/* Title */}
                        <span className="text-sm text-gray-200 flex-1 truncate">{card.title}</span>

                        {/* Column badge */}
                        <span
                          className="px-2 py-0.5 text-[11px] font-medium rounded-full shrink-0"
                          style={{ backgroundColor: card.column_color + "20", color: card.column_color }}
                        >
                          {card.column_name}
                        </span>

                        {/* Assignee avatar */}
                        {displayName && displayColor ? (
                          <div
                            className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-semibold text-white shrink-0"
                            style={{ backgroundColor: displayColor }}
                            title={displayName}
                          >
                            {displayName.charAt(0).toUpperCase()}
                          </div>
                        ) : displayName ? (
                          <div
                            className="w-6 h-6 rounded-full bg-surface-600 flex items-center justify-center text-[10px] font-semibold text-gray-400 uppercase shrink-0"
                            title={displayName}
                          >
                            {displayName.charAt(0)}
                          </div>
                        ) : null}

                        {/* Due date */}
                        {card.due_date && (
                          <span className={`flex items-center gap-1 text-[11px] shrink-0 ${dueDateColor}`}>
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                            {formatDueDate(card.due_date)}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Card modal */}
      {modalCard && (
        <CardModal
          card={modalCard}
          onClose={() => setModalCard(null)}
          onUpdate={handleCardUpdate}
          onDelete={handleCardDelete}
        />
      )}
    </div>
  );
}
