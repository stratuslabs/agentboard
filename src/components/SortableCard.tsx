"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import KanbanCard from "./KanbanCard";
import type { Card } from "../lib/cards";

interface SortableCardProps {
  card: Card;
  productKey?: string | null;
  onClick: () => void;
  selected?: boolean;
}

export default function SortableCard({ card, productKey, onClick, selected }: SortableCardProps) {
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
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <KanbanCard card={card} productKey={productKey} onClick={onClick} selected={selected} />
    </div>
  );
}
