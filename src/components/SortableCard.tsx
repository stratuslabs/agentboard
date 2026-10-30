"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import KanbanCard from "./KanbanCard";
import { isMenuKey, menuPoint } from "./CardContextMenu";
import type { Card } from "../lib/cards";

interface SortableCardProps {
  card: Card;
  productKey?: string | null;
  onClick: () => void;
  selected?: boolean;
  /** Right-click, Shift+F10 or the ContextMenu key: open this card's menu here. */
  onOpenMenu?: (point: { x: number; y: number }, el: HTMLElement) => void;
}

export default function SortableCard({ card, productKey, onClick, selected, onOpenMenu }: SortableCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: card.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onContextMenu={onOpenMenu && ((e) => {
        e.preventDefault();
        const el = e.currentTarget;
        onOpenMenu(menuPoint(el.getBoundingClientRect(), { x: e.clientX, y: e.clientY }), el);
      })}
      onKeyDown={(e) => {
        listeners?.onKeyDown?.(e);
        if (!onOpenMenu || e.target !== e.currentTarget || !isMenuKey(e)) return;
        e.preventDefault();
        onOpenMenu(menuPoint(e.currentTarget.getBoundingClientRect()), e.currentTarget);
      }}
    >
      <KanbanCard card={card} productKey={productKey} onClick={onClick} selected={selected} />
    </div>
  );
}
