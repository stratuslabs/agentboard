"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  DndContext,
  closestCorners,
  DragOverlay,
  DragStartEvent,
  DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import SortableCard from "./SortableCard";
import KanbanCard from "./KanbanCard";
import CardModal from "./CardModal";

interface Card {
  id: number;
  column_id: number;
  title: string;
  description: string;
  assignee: string | null;
  priority: string;
  labels: string;
  github_issue_url: string | null;
  github_pr_url: string | null;
  position: number;
  created_at: string;
  updated_at: string;
}

interface Column {
  id: number;
  board_id: number;
  name: string;
  slug: string;
  position: number;
  color: string;
}

interface Board {
  id: number;
  product_id: number;
  name: string;
  slug: string;
  position: number;
}

interface KanbanBoardProps {
  productId: number;
  orgName: string;
  productName: string;
  productEmoji: string;
  isStarred: boolean;
  onToggleStar: () => void;
}

export default function KanbanBoard({
  productId,
  orgName,
  productName,
  productEmoji,
  isStarred,
  onToggleStar,
}: KanbanBoardProps) {
  const [boards, setBoards] = useState<Board[]>([]);
  const [activeBoardId, setActiveBoardId] = useState<number | null>(null);
  const [columns, setColumns] = useState<Column[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [activeCard, setActiveCard] = useState<Card | null>(null);
  const [modalCard, setModalCard] = useState<Card | null>(null);
  const [addingCardColId, setAddingCardColId] = useState<number | null>(null);
  const [newCardTitle, setNewCardTitle] = useState("");
  const [addingColumn, setAddingColumn] = useState(false);
  const [newColumnName, setNewColumnName] = useState("");
  const [filterAssignee, setFilterAssignee] = useState("");
  const [filterPriority, setFilterPriority] = useState("");
  const [filterLabel, setFilterLabel] = useState("");

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const activeBoardIdRef = useRef(activeBoardId);
  activeBoardIdRef.current = activeBoardId;

  const loadBoards = useCallback(async () => {
    const res = await fetch(`/api/boards?product_id=${productId}`);
    if (!res.ok) return;
    const data: Board[] = await res.json();
    setBoards(data);
    if (data.length > 0) {
      setActiveBoardId(data[0].id);
    }
  }, [productId]);

  const loadColumns = useCallback(async () => {
    const boardId = activeBoardIdRef.current;
    if (!boardId) return;
    const res = await fetch(`/api/columns?board_id=${boardId}`);
    if (res.ok) {
      setColumns(await res.json());
    }
  }, []);

  const loadCards = useCallback(async () => {
    const boardId = activeBoardIdRef.current;
    if (!boardId) return;
    const res = await fetch(`/api/cards?board_id=${boardId}`);
    if (res.ok) {
      setCards(await res.json());
    }
  }, []);

  useEffect(() => {
    loadBoards();
  }, [loadBoards]);

  useEffect(() => {
    if (activeBoardId) {
      loadColumns();
      loadCards();
    }
  }, [activeBoardId, loadColumns, loadCards]);

  const getFilteredCards = useCallback(
    (columnId: number) => {
      return cards
        .filter((c) => c.column_id === columnId)
        .filter(
          (c) =>
            !filterAssignee ||
            (c.assignee &&
              c.assignee.toLowerCase().includes(filterAssignee.toLowerCase()))
        )
        .filter((c) => !filterPriority || c.priority === filterPriority)
        .filter(
          (c) =>
            !filterLabel ||
            (c.labels &&
              c.labels.toLowerCase().includes(filterLabel.toLowerCase()))
        )
        .sort((a, b) => a.position - b.position);
    },
    [cards, filterAssignee, filterPriority, filterLabel]
  );

  function handleDragStart(event: DragStartEvent) {
    const card = cards.find((c) => c.id === event.active.id);
    if (card) setActiveCard(card);
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveCard(null);

    if (!over) return;

    const cardId = active.id as number;
    const card = cards.find((c) => c.id === cardId);
    if (!card) return;

    // Determine target column: over could be a card or a column
    let targetColumnId: number;
    const overCard = cards.find((c) => c.id === over.id);
    if (overCard) {
      targetColumnId = overCard.column_id;
    } else {
      // over.id might be a column droppable id like "column-5"
      const colIdStr = String(over.id);
      if (colIdStr.startsWith("column-")) {
        targetColumnId = parseInt(colIdStr.replace("column-", ""), 10);
      } else {
        return;
      }
    }

    if (card.column_id === targetColumnId && !overCard) return;

    // Optimistic update
    setCards((prev) =>
      prev.map((c) =>
        c.id === cardId ? { ...c, column_id: targetColumnId } : c
      )
    );

    await fetch(`/api/cards/${cardId}/move`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ column_id: targetColumnId }),
    });

    loadCards();
  }

  async function handleAddCard(columnId: number) {
    if (!newCardTitle.trim()) return;
    const res = await fetch("/api/cards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ column_id: columnId, title: newCardTitle.trim() }),
    });
    if (res.ok) {
      setNewCardTitle("");
      setAddingCardColId(null);
      loadCards();
    }
  }

  async function handleAddColumn() {
    if (!newColumnName.trim() || !activeBoardId) return;
    const res = await fetch("/api/columns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        board_id: activeBoardId,
        name: newColumnName.trim(),
      }),
    });
    if (res.ok) {
      setNewColumnName("");
      setAddingColumn(false);
      loadColumns();
    }
  }

  function handleCardUpdate(updatedCard: Card) {
    setCards((prev) =>
      prev.map((c) => (c.id === updatedCard.id ? updatedCard : c))
    );
    setModalCard(updatedCard);
  }

  function handleCardDelete(cardId: number) {
    setCards((prev) => prev.filter((c) => c.id !== cardId));
    setModalCard(null);
  }

  const hasFilters = filterAssignee || filterPriority || filterLabel;

  const assignees = Array.from(
    new Set(cards.map((c) => c.assignee).filter(Boolean) as string[])
  );

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Breadcrumb + Board tabs */}
      <div className="border-b border-surface-600 px-6 pt-4 pb-0">
        <div className="flex items-center gap-2 text-sm text-gray-400 mb-3">
          <span>{orgName}</span>
          <svg
            className="w-3 h-3"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 5l7 7-7 7"
            />
          </svg>
          <span className="text-white font-medium">
            {productEmoji} {productName}
          </span>
          <button onClick={onToggleStar}
            className={`w-5 h-5 flex items-center justify-center rounded transition-colors ${isStarred ? "text-yellow-400 hover:text-yellow-300" : "text-gray-600 hover:text-gray-400"}`}
            title={isStarred ? "Unstar" : "Star"}>
            <svg className="w-4 h-4" viewBox="0 0 20 20" fill={isStarred ? "currentColor" : "none"} stroke="currentColor" strokeWidth={isStarred ? 0 : 1.5}>
              <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
            </svg>
          </button>
        </div>

        <div className="flex gap-1">
          {boards.map((board) => (
            <button
              key={board.id}
              onClick={() => setActiveBoardId(board.id)}
              className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
                activeBoardId === board.id
                  ? "bg-surface-700 text-white border-t border-x border-surface-500"
                  : "text-gray-400 hover:text-gray-300 hover:bg-surface-800"
              }`}
            >
              {board.name}
            </button>
          ))}
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-3 px-6 py-2 border-b border-surface-600 bg-surface-800/50">
        <span className="text-xs text-gray-500 font-medium">Filter:</span>
        <select
          value={filterAssignee}
          onChange={(e) => setFilterAssignee(e.target.value)}
          className="px-2 py-1 bg-surface-700 border border-surface-500 rounded text-xs text-gray-300 focus:outline-none focus:ring-1 focus:ring-accent"
        >
          <option value="">All assignees</option>
          {assignees.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <select
          value={filterPriority}
          onChange={(e) => setFilterPriority(e.target.value)}
          className="px-2 py-1 bg-surface-700 border border-surface-500 rounded text-xs text-gray-300 focus:outline-none focus:ring-1 focus:ring-accent"
        >
          <option value="">All priorities</option>
          <option value="urgent">Urgent</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <input
          type="text"
          value={filterLabel}
          onChange={(e) => setFilterLabel(e.target.value)}
          className="px-2 py-1 bg-surface-700 border border-surface-500 rounded text-xs text-gray-300 placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-accent w-32"
          placeholder="Filter by label"
        />
        {hasFilters && (
          <button
            onClick={() => {
              setFilterAssignee("");
              setFilterPriority("");
              setFilterLabel("");
            }}
            className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
          >
            Clear
          </button>
        )}
      </div>

      {/* Columns */}
      <div className="flex-1 overflow-x-auto p-6">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div className="flex gap-4 h-full">
            {columns.map((column) => {
              const colCards = getFilteredCards(column.id);
              return (
                <div
                  key={column.id}
                  className="w-72 shrink-0 flex flex-col bg-surface-900/50 rounded-xl border border-surface-600"
                >
                  {/* Column header */}
                  <div className="flex items-center justify-between px-3 py-2.5 border-b border-surface-600">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-2.5 h-2.5 rounded-full"
                        style={{ backgroundColor: column.color }}
                      />
                      <span className="text-sm font-medium text-gray-200">
                        {column.name}
                      </span>
                      <span className="text-xs text-gray-500 bg-surface-700 px-1.5 py-0.5 rounded-full">
                        {colCards.length}
                      </span>
                    </div>
                    <button
                      onClick={() => {
                        setAddingCardColId(column.id);
                        setNewCardTitle("");
                      }}
                      className="w-6 h-6 rounded hover:bg-surface-600 flex items-center justify-center text-gray-500 hover:text-gray-300 transition-colors"
                    >
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M12 4v16m8-8H4"
                        />
                      </svg>
                    </button>
                  </div>

                  {/* Cards */}
                  <div className="flex-1 overflow-y-auto p-2 space-y-2">
                    <SortableContext
                      items={colCards.map((c) => c.id)}
                      strategy={verticalListSortingStrategy}
                      id={`column-${column.id}`}
                    >
                      {colCards.map((card) => (
                        <SortableCard
                          key={card.id}
                          card={card}
                          onClick={() => setModalCard(card)}
                        />
                      ))}
                    </SortableContext>

                    {/* Droppable area for empty columns */}
                    {colCards.length === 0 && (
                      <div
                        data-droppable-id={`column-${column.id}`}
                        className="h-16 rounded-lg border-2 border-dashed border-surface-600 flex items-center justify-center text-xs text-gray-600"
                      >
                        Drop cards here
                      </div>
                    )}

                    {/* Add card form */}
                    {addingCardColId === column.id && (
                      <div className="p-2 bg-surface-800 rounded-lg border border-surface-600">
                        <input
                          type="text"
                          value={newCardTitle}
                          onChange={(e) => setNewCardTitle(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleAddCard(column.id);
                            if (e.key === "Escape") setAddingCardColId(null);
                          }}
                          className="w-full px-2 py-1.5 bg-surface-700 border border-surface-500 rounded text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-accent"
                          placeholder="Card title"
                          autoFocus
                        />
                        <div className="flex gap-2 mt-2">
                          <button
                            onClick={() => handleAddCard(column.id)}
                            className="px-3 py-1 bg-accent hover:bg-accent-hover text-white text-xs font-medium rounded transition-colors"
                          >
                            Add
                          </button>
                          <button
                            onClick={() => setAddingCardColId(null)}
                            className="px-3 py-1 text-xs text-gray-400 hover:text-white transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {/* Add column button */}
            {addingColumn ? (
              <div className="w-72 shrink-0 p-3 bg-surface-900/50 rounded-xl border border-surface-600 self-start">
                <input
                  type="text"
                  value={newColumnName}
                  onChange={(e) => setNewColumnName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleAddColumn();
                    if (e.key === "Escape") {
                      setAddingColumn(false);
                      setNewColumnName("");
                    }
                  }}
                  className="w-full px-2 py-1.5 bg-surface-700 border border-surface-500 rounded text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-accent"
                  placeholder="Column name"
                  autoFocus
                />
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={handleAddColumn}
                    className="px-3 py-1 bg-accent hover:bg-accent-hover text-white text-xs font-medium rounded transition-colors"
                  >
                    Add
                  </button>
                  <button
                    onClick={() => {
                      setAddingColumn(false);
                      setNewColumnName("");
                    }}
                    className="px-3 py-1 text-xs text-gray-400 hover:text-white transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setAddingColumn(true)}
                className="w-72 shrink-0 h-12 rounded-xl border-2 border-dashed border-surface-600 flex items-center justify-center gap-2 text-sm text-gray-500 hover:text-gray-300 hover:border-surface-500 transition-colors self-start"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 4v16m8-8H4"
                  />
                </svg>
                Add column
              </button>
            )}
          </div>

          <DragOverlay>
            {activeCard ? (
              <div className="opacity-90">
                <KanbanCard card={activeCard} onClick={() => {}} />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
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
