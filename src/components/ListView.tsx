"use client";

import { useState } from "react";
import { ArrowLeft, Calendar } from "lucide-react";
import CardModal from "./CardModal";
import { Avatar, EmptyState, IconButton, PriorityDot, StatusBadge, cx } from "./ui";
import { type Card, DUE_TEXT, displayAssignee, formatDueDate, getDueDateStatus } from "@/lib/cards";

export interface ViewCard extends Card {
  org_name: string;
  product_name: string;
  product_emoji: string;
  board_name: string;
  column_name: string;
  column_color: string;
}

interface ListViewProps {
  cards: ViewCard[];
  title: string;
  icon: React.ReactNode;
  /** Shown under "No cards found". */
  emptyMessage: string;
  emptyIcon?: React.ReactNode;
  tone?: "default" | "danger";
  onRefresh: () => void;
  onBack?: () => void;
}

export default function ListView({ cards, title, icon, emptyMessage, emptyIcon, tone = "default", onRefresh, onBack }: ListViewProps) {
  const [modalCard, setModalCard] = useState<ViewCard | null>(null);

  // Group cards by product
  const grouped = cards.reduce<Record<string, { emoji: string; name: string; cards: ViewCard[] }>>((acc, card) => {
    const key = `${card.product_emoji} ${card.product_name}`;
    if (!acc[key]) acc[key] = { emoji: card.product_emoji, name: card.product_name, cards: [] };
    acc[key].cards.push(card);
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
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex h-14 shrink-0 items-center gap-2.5 border-b border-border px-8 max-md:px-4">
        {onBack && (
          <IconButton onClick={onBack} title="Back" aria-label="Back" size={28} className="-ml-1.5">
            <ArrowLeft className="h-4 w-4" />
          </IconButton>
        )}
        <span className={cx("flex [&>svg]:h-[17px] [&>svg]:w-[17px]", tone === "danger" ? "text-danger" : "text-text-1")}>{icon}</span>
        <h1 className="text-base font-semibold tracking-[-0.2px] text-text-1">{title}</h1>
        <span className="font-mono text-[11.5px] text-text-3">
          {cards.length} {cards.length === 1 ? "card" : "cards"}
        </span>
      </div>

      {/* Content */}
      <div className="flex flex-1 flex-col overflow-y-auto px-8 py-7 max-md:px-4">
        {cards.length === 0 ? (
          <EmptyState className="flex-1 pb-20" icon={emptyIcon ?? icon} title="No cards found" body={emptyMessage} />
        ) : (
          <div className="flex max-w-[880px] flex-col gap-6">
            {Object.entries(grouped).map(([key, group]) => (
              <section key={key} className="flex flex-col gap-2">
                <h2 className="flex items-center gap-2 px-0.5">
                  <span className="text-[12.5px] font-semibold text-text-2">{group.emoji}&nbsp; {group.name}</span>
                  <span className="font-mono text-[11px] text-text-4">{group.cards.length}</span>
                </h2>
                <div className="flex flex-col gap-1">
                  {group.cards.map((card) => {
                    const dueStatus = card.due_date ? getDueDateStatus(card.due_date) : null;
                    const displayName = displayAssignee(card);

                    return (
                      <button
                        key={card.id}
                        onClick={() => setModalCard(card)}
                        className="flex h-11 w-full items-center gap-3 rounded-lg border border-border bg-surface-1 px-3.5 text-left transition-colors hover:border-border-strong hover:bg-surface-2"
                      >
                        <PriorityDot priority={card.priority} />
                        <span className="min-w-0 flex-1 truncate text-[13.5px] text-text-1">{card.title}</span>
                        <StatusBadge color={card.column_color}>{card.column_name}</StatusBadge>
                        {displayName ? (
                          <span title={displayName}><Avatar name={displayName} color={card.assignee_color} size={22} /></span>
                        ) : (
                          <span className="w-[22px] shrink-0" />
                        )}
                        <span className={cx("flex w-[62px] shrink-0 items-center gap-[5px] font-mono text-[11.5px]", dueStatus ? DUE_TEXT[dueStatus] : "")}>
                          {card.due_date && (
                            <>
                              <Calendar className="h-3 w-3" />
                              {formatDueDate(card.due_date)}
                            </>
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>
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
