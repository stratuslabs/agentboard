"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, Calendar } from "lucide-react";
import CardDetail from "./CardDetail";
import { Avatar, EmptyState, IconButton, PriorityDot, StatusBadge, cx } from "./ui";
import { type Card, DUE_TEXT, displayAssignee, formatDueDate, getDueDateStatus, readCardParam, writeCardParam } from "@/lib/cards";

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
  const [openCardId, setOpenCardId] = useState<number | null>(null);
  const [cardView, setCardView] = useState<"panel" | "page">("panel");
  // The open card, held here as well as read from `cards`: an edit can take it
  // out of this list (a new due date on Today, Done on Past Due) and the panel
  // stays on it. A `?card=` link to a card outside the list is fetched into it.
  const [heldCard, setHeldCard] = useState<ViewCard | null>(null);

  useEffect(() => {
    const { cardId, full } = readCardParam();
    if (!cardId) return;
    setOpenCardId(cardId);
    setCardView(full ? "page" : "panel");
    fetch(`/api/cards/${cardId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((c) => {
        if (c) setHeldCard({ ...c, org_name: "", product_emoji: "", column_color: "" });
        else { setOpenCardId(null); writeCardParam(null); }
      })
      .catch(() => {});
  }, []);

  // Group cards by product
  const grouped = cards.reduce<Record<string, { emoji: string; name: string; cards: ViewCard[] }>>((acc, card) => {
    const key = `${card.product_emoji} ${card.product_name}`;
    if (!acc[key]) acc[key] = { emoji: card.product_emoji, name: card.product_name, cards: [] };
    acc[key].cards.push(card);
    return acc;
  }, {});

  // Rows in the order they are shown, which is what prev/next walks.
  const ordered = Object.values(grouped).flatMap((g) => g.cards);
  const openCard = openCardId === null
    ? null
    : ordered.find((c) => c.id === openCardId) ?? (heldCard?.id === openCardId ? heldCard : null);

  function open(card: ViewCard, view: "panel" | "page" = cardView) {
    const cardId = card.id;
    setHeldCard(card);
    setOpenCardId(cardId);
    setCardView(view);
    writeCardParam(cardId, view === "page");
  }

  function close() {
    setOpenCardId(null);
    setCardView("panel");
    writeCardParam(null);
  }

  function handleCardUpdate(updated: Card) {
    setHeldCard((prev) => (prev && prev.id === updated.id ? { ...prev, ...updated } : prev));
    onRefresh();
  }

  function handleCardDelete() {
    close();
    onRefresh();
  }

  const detail = openCard && (
    <CardDetail
      key={openCard.id}
      mode={cardView}
      card={openCard}
      context={{ orgName: openCard.org_name || undefined, productEmoji: openCard.product_emoji, productName: openCard.product_name, boardName: openCard.board_name }}
      siblings={ordered.some((c) => c.id === openCard.id) ? ordered : undefined}
      siblingsLabel={title}
      onNavigate={(c) => open(ordered.find((o) => o.id === c.id) ?? (c as ViewCard))}
      onClose={close}
      onToggleMode={() => open(openCard, cardView === "page" ? "panel" : "page")}
      onUpdate={handleCardUpdate}
      onDelete={handleCardDelete}
    />
  );

  if (openCard && cardView === "page") return detail;

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
                        onClick={() => open(card)}
                        className={cx("flex h-11 w-full items-center gap-3 rounded-lg border px-3.5 text-left transition-colors hover:border-border-strong hover:bg-surface-2", openCardId === card.id ? "border-text-3 bg-surface-2" : "border-border bg-surface-1")}
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

      {detail}
    </div>
  );
}
