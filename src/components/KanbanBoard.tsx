"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useBoardStream } from "@/lib/useBoardStream";
import {
  DndContext,
  closestCorners,
  rectIntersection,
  pointerWithin,
  DragOverlay,
  DragStartEvent,
  DragEndEvent,
  DragOverEvent,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  CollisionDetection,
  DroppableContainer,
  UniqueIdentifier,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { ArrowLeft, ArrowLeftToLine, ArrowRightToLine, ChevronRight, Ellipsis, ListFilter, Pencil, Plus, Star, Tag, Trash2, X } from "lucide-react";
import SortableCard from "./SortableCard";
import KanbanCard from "./KanbanCard";
import CardDetail from "./CardDetail";
import ConfirmModal from "./ConfirmModal";
import { Button, IconButton, MenuDivider, MenuItem, MenuPanel, Select, cx } from "./ui";
import { usePreferences } from "@/contexts/PreferencesContext";
import { type Card, type Member, readCardParam, writeCardParam } from "@/lib/cards";

function DroppableColumn({ columnId, children }: { columnId: number; children: React.ReactNode }) {
  const { setNodeRef } = useDroppable({ id: `column-${columnId}` });
  return <div ref={setNodeRef} className="flex flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">{children}</div>;
}

// Custom collision detection: prefer cards (pointerWithin), fall back to columns (rectIntersection)
const customCollisionDetection: CollisionDetection = (args) => {
  // First try pointerWithin for precise card targeting
  const pointerCollisions = pointerWithin(args);
  if (pointerCollisions.length > 0) {
    // Prefer card collisions over column collisions
    const cardCollision = pointerCollisions.find((c) => !String(c.id).startsWith("column-"));
    if (cardCollision) return [cardCollision];
    return pointerCollisions;
  }

  // Fall back to rectIntersection for column-level drops
  const rectCollisions = rectIntersection(args);
  if (rectCollisions.length > 0) {
    // Prefer column droppables
    const columnCollision = rectCollisions.find((c) => String(c.id).startsWith("column-"));
    if (columnCollision) return [columnCollision];
    return rectCollisions;
  }

  return closestCorners(args);
};

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
  onBack?: () => void;
}

export default function KanbanBoard({
  productId,
  orgName,
  productName,
  productEmoji,
  onBack,
}: KanbanBoardProps) {
  const { isStarred: isStarredFn, toggleStarredProduct } = usePreferences();
  const isStarred = isStarredFn(productId);
  const onToggleStar = () => toggleStarredProduct(productId);
  const [boards, setBoards] = useState<Board[]>([]);
  const [activeBoardId, setActiveBoardId] = useState<number | null>(null);
  const [columns, setColumns] = useState<Column[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [activeCard, setActiveCard] = useState<Card | null>(null);
  // The open card is an id, not a copy: it reads through to `cards`, so live
  // updates reach the panel and a card deleted elsewhere closes it.
  const [openCardId, setOpenCardId] = useState<number | null>(null);
  const [cardView, setCardView] = useState<"panel" | "page">("panel");
  const [addingCardColId, setAddingCardColId] = useState<number | null>(null);
  const [newCardTitle, setNewCardTitle] = useState("");
  const [addingColumn, setAddingColumn] = useState(false);
  const [newColumnName, setNewColumnName] = useState("");
  const [filterAssignee, setFilterAssignee] = useState("");
  const [filterPriority, setFilterPriority] = useState("");
  const [filterLabel, setFilterLabel] = useState("");
  const [members, setMembers] = useState<Member[]>([]);
  const [addingBoard, setAddingBoard] = useState(false);
  const [newBoardName, setNewBoardName] = useState("");
  const [boardContextMenu, setBoardContextMenu] = useState<{ boardId: number; x: number; y: number } | null>(null);
  const [renamingBoardId, setRenamingBoardId] = useState<number | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ title: string; message: string; action: () => void } | null>(null);
  const [renameBoardName, setRenameBoardName] = useState("");
  const [columnContextMenu, setColumnContextMenu] = useState<{ columnId: number; x: number; y: number } | null>(null);
  const [renamingColumnId, setRenamingColumnId] = useState<number | null>(null);
  const [renameColumnName, setRenameColumnName] = useState("");

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  // Lets loadColumns and loadCards keep stable identities while still reading
  // the current board. Written in an effect rather than during render, which
  // React forbids — under StrictMode's double render the second pass would see
  // a ref already mutated by the first. Declared above the effect that calls
  // those two, since effects commit in declaration order and they would
  // otherwise fetch against the previous board on a switch.
  const activeBoardIdRef = useRef(activeBoardId);
  useEffect(() => {
    activeBoardIdRef.current = activeBoardId;
  }, [activeBoardId]);

  // Mirrored for `refreshBoard`, which merges a delta against the cards it
  // already has and must not read them through a stale closure. Written in an
  // effect for the same reason as the ref above.
  const cardsRef = useRef<Card[]>(cards);
  useEffect(() => {
    cardsRef.current = cards;
  }, [cards]);

  /**
   * The server's own clock, as of the last response. Sent back as
   * `updated_since` so the next fetch carries only what changed. Null means
   * "ask for everything" — on first load, after a board switch, or whenever a
   * merge turns out not to reconcile.
   */
  const cursorRef = useRef<string | null>(null);

  /**
   * Which refresh is the current one.
   *
   * Change events, mutation handlers and the end of a drag can all call
   * `refreshBoard` at once — a drag alone emits a move and a reorder and then
   * reloads. Responses can come back out of order, and an older snapshot
   * applied after a newer one leaves the board wrong, with an older cursor to
   * match. Only the newest request is allowed to write.
   */
  const refreshSeqRef = useRef(0);
  const appliedSeqRef = useRef(0);

  /**
   * One request for the whole screen: boards, columns and cards together.
   *
   * Boards and columns always come back whole because they are small. Cards
   * arrive as a delta plus `card_ids` — every id on the board, in order — and
   * that id list is what makes deletions visible: a row that no longer exists
   * can never appear in a "changed since" result, so membership is rebuilt from
   * the list rather than inferred from the changes.
   */
  const refreshBoard = useCallback(
    async (opts?: { full?: boolean }) => {
      // Named so the merge-gap path below can retry itself. Recursing through
      // `refreshBoard` would read the const this callback is still
      // initialising.
      const run = async (full: boolean): Promise<void> => {
        const seq = ++refreshSeqRef.current;
        const params = new URLSearchParams({ product_id: String(productId) });
        const requestedBoardId = activeBoardIdRef.current;
        if (requestedBoardId) params.set("board_id", String(requestedBoardId));
        const since = full ? null : cursorRef.current;
        if (since) params.set("updated_since", since);

        // A refresh is fired from event handlers that do not await it, so a
        // rejected fetch — offline, a dropped connection — would surface as an
        // unhandled rejection rather than a skipped refresh. Failing quietly is
        // right here: the stream will say so again, and the sweep is behind it.
        let res: Response;
        try {
          res = await fetch(`/api/board?${params.toString()}`);
        } catch {
          return;
        }
        // The product, or the organization above it, was deleted by somebody
        // else. A cascade notification is what woke us, so the useful answer
        // is to stop rendering rows that no longer exist — holding the last
        // good snapshot leaves a board on screen that every edit will refuse.
        if (res.status === 404) {
          if (seq <= appliedSeqRef.current) return;
          appliedSeqRef.current = seq;
          cursorRef.current = null;
          setBoards([]);
          setColumns([]);
          setCards([]);
          setActiveBoardId(null);
          return;
        }
        if (!res.ok) return;
        const data = await res.json();

        // Superseded while in flight. Two ways that happens, and both make the
        // answer worthless: the user switched boards — applying it would replace
        // the new board's cards with the old board's and then switch them back —
        // or a later refresh for this same board has already answered, in which
        // case this is an older snapshot and an older cursor.
        //
        // Compared against what was last *applied*, not what was last issued.
        // Keyed to the newest request, a newer one that fails or never returns
        // would claim the sequence and discard the older response that did
        // arrive — leaving the board stale with nothing left to retry.
        if (seq <= appliedSeqRef.current) return;
        if (activeBoardIdRef.current !== requestedBoardId) return;
        appliedSeqRef.current = seq;

        setBoards(data.boards);
        setColumns(data.columns);

        if (data.card_ids) {
          const byId = new Map<number, Card>(cardsRef.current.map((c) => [c.id, c]));
          for (const card of data.cards as Card[]) byId.set(card.id, card);
          const merged = (data.card_ids as number[]).map((id) => byId.get(id));

          // A gap means the cursor did not belong to this board, or an update
          // went missing. Rather than render a board with holes in it, drop the
          // cursor and take the whole thing again.
          if (merged.some((card) => card === undefined)) {
            cursorRef.current = null;
            await run(true);
            return;
          }
          setCards(merged as Card[]);
        } else {
          setCards(data.cards);
        }

        cursorRef.current = data.server_time;
        // Only meaningful now that the response is known to be for the board
        // still on screen: this is the server telling us our board is gone and
        // naming the fallback it chose, not a race arriving late.
        //
        // Null is an answer too, and a truthy test swallowed it: when the last
        // board on a product is deleted there is no fallback, and keeping the
        // dead id active left the tab holding a board that no longer exists.
        if (data.active_board_id !== requestedBoardId) {
          setActiveBoardId(data.active_board_id ?? null);
        }
      };

      return run(opts?.full ?? false);
    },
    [productId]
  );

  // Kept under their old names: every mutation handler below already calls the
  // one it cares about, and each is now the same single request.
  const loadBoards = refreshBoard;
  const loadColumns = refreshBoard;
  const loadCards = refreshBoard;

  useEffect(() => {
    refreshBoard({ full: true });
    fetch("/api/members").then((r) => r.json()).then(setMembers).catch(() => {});
  }, [refreshBoard]);

  // Switching boards invalidates the cursor — it describes a different board's
  // history — so the new board is fetched whole.
  useEffect(() => {
    if (!activeBoardId) return;
    cursorRef.current = null;
    refreshBoard({ full: true });
  }, [activeBoardId, refreshBoard]);

  /**
   * Live updates, in place of the three-second poll this used to run.
   *
   * Events that land mid-drag are held, not applied: the board is showing an
   * optimistic position that the pointer still owns, and replacing the cards
   * underneath it would fight the gesture. The flag is drained on drop.
   */
  const pendingRefreshRef = useRef(false);
  const draggingRef = useRef(false);
  useEffect(() => {
    draggingRef.current = activeCard !== null;
  }, [activeCard]);

  // Subscribed to everything rather than to the active board. This screen
  // renders the product's whole board-tab row, so a sibling board being
  // created, renamed or deleted changes what is on screen even though the
  // notification names a board the user is not looking at. The connection is
  // already unscoped — filtering happens here, not on the server — so the only
  // cost is a delta fetch that an ETag usually answers with a 304.
  useBoardStream(null, () => {
    if (draggingRef.current) {
      pendingRefreshRef.current = true;
      return;
    }
    refreshBoard();
  });

  useEffect(() => {
    if (activeCard === null && pendingRefreshRef.current) {
      pendingRefreshRef.current = false;
      refreshBoard();
    }
  }, [activeCard, refreshBoard]);

  const getFilteredCards = useCallback(
    (columnId: number) => {
      return cards
        .filter((c) => c.column_id === columnId)
        .filter((c) => {
          if (!filterAssignee) return true;
          if (filterAssignee === "__unassigned__") return !c.assignee_id && !c.assignee;
          // filterAssignee is a member id string
          return String(c.assignee_id) === filterAssignee;
        })
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

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over) return;

    const cardId = active.id as number;
    const card = cards.find((c) => c.id === cardId);
    if (!card) return;

    // Determine target column
    let targetColumnId: number | null = null;
    const overCard = cards.find((c) => c.id === over.id);
    if (overCard) {
      targetColumnId = overCard.column_id;
    } else {
      const colIdStr = String(over.id);
      if (colIdStr.startsWith("column-")) {
        targetColumnId = parseInt(colIdStr.replace("column-", ""), 10);
      }
    }

    if (targetColumnId === null || card.column_id === targetColumnId) return;

    // Optimistically move card to new column during drag
    setCards((prev) =>
      prev.map((c) =>
        c.id === cardId ? { ...c, column_id: targetColumnId } : c
      )
    );
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveCard(null);

    if (!over) return;

    const cardId = active.id as number;
    const card = cards.find((c) => c.id === cardId);
    if (!card) return;

    // Determine target column
    let targetColumnId: number;
    const overCard = cards.find((c) => c.id === over.id);
    if (overCard) {
      targetColumnId = overCard.column_id;
    } else {
      const colIdStr = String(over.id);
      if (colIdStr.startsWith("column-")) {
        targetColumnId = parseInt(colIdStr.replace("column-", ""), 10);
      } else {
        return;
      }
    }

    // Get cards in target column (card should already be there from dragOver)
    const columnCards = cards
      .filter((c) => c.column_id === targetColumnId)
      .sort((a, b) => a.position - b.position);

    const oldIndex = columnCards.findIndex((c) => c.id === cardId);
    const newIndex = overCard ? columnCards.findIndex((c) => c.id === overCard.id) : columnCards.length - 1;

    if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
      // Reorder within column
      const reordered = arrayMove(columnCards, oldIndex, newIndex);
      // Optimistic update with new positions
      setCards((prev) => {
        const otherCards = prev.filter((c) => c.column_id !== targetColumnId);
        const updated = reordered.map((c, i) => ({ ...c, position: i }));
        return [...otherCards, ...updated];
      });
    }

    // Persist: move card to target column at the right position
    const finalColumnCards = (() => {
      const cc = cards.filter((c) => c.column_id === targetColumnId).sort((a, b) => a.position - b.position);
      if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
        return arrayMove(cc, oldIndex, newIndex);
      }
      return cc;
    })();
    const finalPosition = finalColumnCards.findIndex((c) => c.id === cardId);

    await fetch(`/api/cards/${cardId}/move`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ column_id: targetColumnId, position: finalPosition >= 0 ? finalPosition : 0 }),
    });

    // Reorder all cards in target column to fix positions
    const idsInOrder = finalColumnCards.map((c) => c.id);
    await fetch("/api/cards/reorder", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: idsInOrder }),
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
      prev.map((c) => (c.id === updatedCard.id ? { ...c, ...updatedCard } : c))
    );
  }

  function handleCardDelete(cardId: number) {
    setCards((prev) => prev.filter((c) => c.id !== cardId));
    closeCard();
  }

  function openCard(cardId: number, view: "panel" | "page" = cardView) {
    setOpenCardId(cardId);
    setCardView(view);
    writeCardParam(cardId, view === "page");
  }

  function closeCard() {
    setOpenCardId(null);
    setCardView("panel");
    writeCardParam(null);
  }

  // A `?card=` link: open it once the board holding it is on screen. The card
  // may live on another of this product's boards, in which case that board is
  // switched to first and the card opens when its cards arrive.
  const deepLinkRef = useRef<{ cardId: number; full: boolean; resolved: boolean } | null>(null);
  useEffect(() => {
    const { cardId, full } = readCardParam();
    if (cardId) deepLinkRef.current = { cardId, full, resolved: false };
  }, []);
  useEffect(() => {
    const link = deepLinkRef.current;
    if (!link || activeBoardId === null) return;
    if (cards.some((c) => c.id === link.cardId)) {
      deepLinkRef.current = null;
      setOpenCardId(link.cardId);
      setCardView(link.full ? "page" : "panel");
      return;
    }
    if (link.resolved || cards.length === 0) return;
    link.resolved = true;
    fetch(`/api/cards/${link.cardId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((found: { product_id: number; board_id: number } | null) => {
        if (found && found.product_id === productId && found.board_id !== activeBoardIdRef.current) {
          setActiveBoardId(found.board_id);
        } else {
          deepLinkRef.current = null;
          if (!found || found.product_id !== productId) writeCardParam(null);
        }
      })
      .catch(() => { deepLinkRef.current = null; });
  }, [cards, activeBoardId, productId]);

  async function handleAddBoard() {
    if (!newBoardName.trim()) return;
    const res = await fetch("/api/boards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ product_id: productId, name: newBoardName.trim() }),
    });
    if (res.ok) {
      const board = await res.json();
      setNewBoardName("");
      setAddingBoard(false);
      await loadBoards();
      setActiveBoardId(board.id);
    }
  }

  async function handleRenameBoard(boardId: number) {
    if (!renameBoardName.trim()) return;
    const res = await fetch(`/api/boards/${boardId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: renameBoardName.trim() }),
    });
    if (res.ok) {
      setRenamingBoardId(null);
      setRenameBoardName("");
      loadBoards();
    }
  }

  function handleDeleteBoard(boardId: number) {
    setConfirmAction({
      title: "Delete board",
      message: "This will delete the board and all its columns and cards.",
      action: async () => {
        await fetch(`/api/boards/${boardId}`, { method: "DELETE" });
        const remaining = boards.filter((b) => b.id !== boardId);
        setBoards(remaining);
        if (activeBoardId === boardId) {
          setActiveBoardId(remaining.length > 0 ? remaining[0].id : null);
        }
        loadBoards();
        setConfirmAction(null);
      },
    });
  }

  async function handleMoveBoardLeft(boardId: number) {
    const idx = boards.findIndex((b) => b.id === boardId);
    if (idx <= 0) return;
    const reordered = arrayMove(boards, idx, idx - 1);
    setBoards(reordered);
    await fetch("/api/boards/reorder", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: reordered.map((b) => b.id) }),
    });
  }

  async function handleMoveBoardRight(boardId: number) {
    const idx = boards.findIndex((b) => b.id === boardId);
    if (idx < 0 || idx >= boards.length - 1) return;
    const reordered = arrayMove(boards, idx, idx + 1);
    setBoards(reordered);
    await fetch("/api/boards/reorder", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: reordered.map((b) => b.id) }),
    });
  }

  async function handleRenameColumn(columnId: number) {
    if (!renameColumnName.trim()) return;
    const res = await fetch(`/api/columns/${columnId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: renameColumnName.trim() }),
    });
    if (res.ok) {
      setRenamingColumnId(null);
      setRenameColumnName("");
      loadColumns();
    }
  }

  async function handleMoveColumnLeft(columnId: number) {
    const idx = columns.findIndex((c) => c.id === columnId);
    if (idx <= 0) return;
    const reordered = arrayMove(columns, idx, idx - 1);
    setColumns(reordered);
    // Update positions via individual PATCH calls
    for (let i = 0; i < reordered.length; i++) {
      await fetch(`/api/columns/${reordered[i].id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ position: i }),
      });
    }
  }

  async function handleMoveColumnRight(columnId: number) {
    const idx = columns.findIndex((c) => c.id === columnId);
    if (idx < 0 || idx >= columns.length - 1) return;
    const reordered = arrayMove(columns, idx, idx + 1);
    setColumns(reordered);
    for (let i = 0; i < reordered.length; i++) {
      await fetch(`/api/columns/${reordered[i].id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ position: i }),
      });
    }
  }

  function handleDeleteColumn(columnId: number) {
    const column = columns.find((c) => c.id === columnId);
    const cardCount = cards.filter((c) => c.column_id === columnId).length;
    setConfirmAction({
      title: "Delete column",
      message: `This will delete "${column?.name || "this column"}"${cardCount > 0 ? ` and its ${cardCount} card${cardCount === 1 ? "" : "s"}` : ""}.`,
      action: async () => {
        await fetch(`/api/columns/${columnId}`, { method: "DELETE" });
        setColumns((prev) => prev.filter((c) => c.id !== columnId));
        setCards((prev) => prev.filter((c) => c.column_id !== columnId));
        setConfirmAction(null);
      },
    });
  }

  // Close context menus on outside click
  useEffect(() => {
    if (!boardContextMenu && !columnContextMenu) return;
    const handler = () => {
      setBoardContextMenu(null);
      setColumnContextMenu(null);
    };
    window.addEventListener("click", handler);
    return () => window.removeEventListener("click", handler);
  }, [boardContextMenu, columnContextMenu]);

  const hasFilters = filterAssignee || filterPriority || filterLabel;

  const openCardObj = openCardId !== null ? cards.find((c) => c.id === openCardId) ?? null : null;
  const activeBoard = boards.find((b) => b.id === activeBoardId);

  function cardDetailProps(card: Card) {
    // Prev/next walks the card's column as it is shown; if a filter hides the
    // card itself, fall back to the whole column so it still has neighbours.
    const visible = getFilteredCards(card.column_id);
    const siblings = visible.some((c) => c.id === card.id)
      ? visible
      : cards.filter((c) => c.column_id === card.column_id).sort((a, b) => a.position - b.position);
    return {
      card,
      columns,
      context: { orgName, productEmoji, productName, boardName: activeBoard?.name },
      siblings,
      siblingsLabel: columns.find((c) => c.id === card.column_id)?.name,
      onNavigate: (c: Card) => openCard(c.id),
      onClose: closeCard,
      onToggleMode: () => openCard(card.id, cardView === "page" ? "panel" : "page"),
      onUpdate: handleCardUpdate,
      onDelete: handleCardDelete,
    };
  }

  if (openCardObj && cardView === "page") {
    return (
      <>
        <CardDetail key={openCardObj.id} mode="page" {...cardDetailProps(openCardObj)} onMove={() => loadCards()} />
        {confirmAction && (
          <ConfirmModal title={confirmAction.title} message={confirmAction.message} onConfirm={confirmAction.action} onCancel={() => setConfirmAction(null)} />
        )}
      </>
    );
  }

  const columnMenuColumn = columnContextMenu ? columns.find((c) => c.id === columnContextMenu.columnId) : null;
  const columnMenuIndex = columnContextMenu ? columns.findIndex((c) => c.id === columnContextMenu.columnId) : -1;

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
      {/* Breadcrumb */}
      <div className="flex h-14 shrink-0 items-center gap-2 px-7 text-[13px] max-md:px-4">
        {onBack && (
          <IconButton onClick={onBack} title="Back" aria-label="Back" size={28} className="-ml-1.5 mr-0.5">
            <ArrowLeft className="h-4 w-4" />
          </IconButton>
        )}
        <span className="truncate text-text-3">{orgName}</span>
        <ChevronRight className="h-[13px] w-[13px] shrink-0 text-text-4" />
        <span className="text-[14px]">{productEmoji}</span>
        <span className="truncate font-semibold text-text-1">{productName}</span>
        <IconButton onClick={onToggleStar} size={24} aria-pressed={isStarred}
          className={isStarred ? "text-text-1" : "text-text-3"}
          title={isStarred ? "Unstar" : "Star"} aria-label={isStarred ? "Unstar product" : "Star product"}>
          <Star className="h-3.5 w-3.5" fill={isStarred ? "currentColor" : "none"} />
        </IconButton>
      </div>

      {/* Board tabs */}
      <div className="flex h-10 shrink-0 items-end gap-6 overflow-x-auto border-b border-border px-7 max-md:px-4">
        {boards.map((board) => {
          const active = activeBoardId === board.id;
          return renamingBoardId === board.id ? (
            <input
              key={board.id}
              type="text"
              value={renameBoardName}
              onChange={(e) => setRenameBoardName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleRenameBoard(board.id);
                if (e.key === "Escape") { setRenamingBoardId(null); setRenameBoardName(""); }
              }}
              onBlur={() => { setRenamingBoardId(null); setRenameBoardName(""); }}
              className="mb-1.5 h-7 w-32 rounded-md border border-border-strong bg-surface-2 px-2 text-[13px] text-text-1 focus:border-text-4 focus:outline-none"
              autoFocus
            />
          ) : (
            <button
              key={board.id}
              onClick={() => setActiveBoardId(board.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                setBoardContextMenu({ boardId: board.id, x: e.clientX, y: e.clientY });
              }}
              className={cx(
                "-mb-px flex h-full shrink-0 items-end border-b-2 pb-2.5 text-[13px] whitespace-nowrap transition-colors",
                active ? "border-ivory font-medium text-text-1" : "border-transparent text-text-3 hover:text-text-2",
              )}
            >
              {board.name}
            </button>
          );
        })}

        {/* Add board button / inline input */}
        {addingBoard ? (
          <div className="mb-1.5 flex shrink-0 items-center gap-1">
            <input
              type="text"
              value={newBoardName}
              onChange={(e) => setNewBoardName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAddBoard();
                if (e.key === "Escape") { setAddingBoard(false); setNewBoardName(""); }
              }}
              className="h-7 w-32 rounded-md border border-border-strong bg-surface-2 px-2 text-[13px] text-text-1 placeholder:text-text-3 focus:border-text-4 focus:outline-none"
              placeholder="Board name"
              autoFocus
            />
            <Button variant="primary" size="sm" className="h-7" onClick={handleAddBoard}>Add</Button>
            <Button variant="ghost" size="sm" className="h-7" onClick={() => { setAddingBoard(false); setNewBoardName(""); }}>Cancel</Button>
          </div>
        ) : (
          <button
            onClick={() => setAddingBoard(true)}
            className="flex h-full shrink-0 items-end pb-3 text-text-3 transition-colors hover:text-text-1"
            title="Add board"
            aria-label="Add board"
          >
            <Plus className="h-[15px] w-[15px]" />
          </button>
        )}
      </div>

      {/* Column menu */}
      {columnContextMenu && (
        <MenuPanel className="fixed w-48" style={{ left: columnContextMenu.x, top: columnContextMenu.y }} onClick={(e) => e.stopPropagation()}>
          <MenuItem icon={<Pencil />} onClick={() => {
            if (columnMenuColumn) {
              setRenamingColumnId(columnMenuColumn.id);
              setRenameColumnName(columnMenuColumn.name);
            }
            setColumnContextMenu(null);
          }}>
            Rename
          </MenuItem>
          <MenuItem icon={<ArrowLeftToLine />} disabled={columnMenuIndex === 0} onClick={() => {
            handleMoveColumnLeft(columnContextMenu.columnId);
            setColumnContextMenu(null);
          }}>
            Move left
          </MenuItem>
          <MenuItem icon={<ArrowRightToLine />} disabled={columnMenuIndex === columns.length - 1} onClick={() => {
            handleMoveColumnRight(columnContextMenu.columnId);
            setColumnContextMenu(null);
          }}>
            Move right
          </MenuItem>
          <MenuDivider />
          <MenuItem danger icon={<Trash2 />} onClick={() => {
            const columnId = columnContextMenu.columnId;
            setColumnContextMenu(null);
            handleDeleteColumn(columnId);
          }}>
            Delete column
          </MenuItem>
        </MenuPanel>
      )}

      {/* Board menu */}
      {boardContextMenu && (
        <MenuPanel className="fixed w-48" style={{ left: boardContextMenu.x, top: boardContextMenu.y }} onClick={(e) => e.stopPropagation()}>
          <MenuItem icon={<Pencil />} onClick={() => {
            const board = boards.find((b) => b.id === boardContextMenu.boardId);
            if (board) {
              setRenamingBoardId(board.id);
              setRenameBoardName(board.name);
            }
            setBoardContextMenu(null);
          }}>
            Rename
          </MenuItem>
          <MenuItem icon={<ArrowLeftToLine />} onClick={() => {
            handleMoveBoardLeft(boardContextMenu.boardId);
            setBoardContextMenu(null);
          }}>
            Move left
          </MenuItem>
          <MenuItem icon={<ArrowRightToLine />} onClick={() => {
            handleMoveBoardRight(boardContextMenu.boardId);
            setBoardContextMenu(null);
          }}>
            Move right
          </MenuItem>
          <MenuDivider />
          <MenuItem danger icon={<Trash2 />} onClick={() => {
            const boardId = boardContextMenu.boardId;
            setBoardContextMenu(null);
            handleDeleteBoard(boardId);
          }}>
            Delete
          </MenuItem>
        </MenuPanel>
      )}

      {/* Filter bar */}
      <div className="flex min-h-[52px] shrink-0 flex-wrap items-center gap-2 border-b border-border px-7 py-2 max-md:px-4">
        <span className="mr-0.5 flex items-center gap-2 text-[12.5px] text-text-3">
          <ListFilter className="h-3.5 w-3.5" />
          Filter
        </span>
        <Select
          aria-label="Filter by assignee"
          value={filterAssignee}
          onChange={(e) => setFilterAssignee(e.target.value)}
          className="w-[140px] [&>select]:h-[30px] [&>select]:rounded-md [&>select]:bg-surface-1 [&>select]:text-[12.5px] [&>select]:text-text-2"
        >
          <option value="">All assignees</option>
          <option value="__unassigned__">Unassigned</option>
          {members.map((m) => (
            <option key={m.id} value={String(m.id)}>
              {m.name}{m.type === "agent" ? " (agent)" : ""}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Filter by priority"
          value={filterPriority}
          onChange={(e) => setFilterPriority(e.target.value)}
          className="w-[132px] [&>select]:h-[30px] [&>select]:rounded-md [&>select]:bg-surface-1 [&>select]:text-[12.5px] [&>select]:text-text-2"
        >
          <option value="">All priorities</option>
          <option value="urgent">Urgent</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </Select>
        <span className="relative">
          <input
            type="text"
            value={filterLabel}
            onChange={(e) => setFilterLabel(e.target.value)}
            aria-label="Filter by label"
            className="h-[30px] w-40 rounded-md border border-border-strong bg-surface-1 pr-8 pl-3 text-[12.5px] text-text-2 placeholder:text-text-4 focus:border-text-4 focus:outline-none"
            placeholder="Filter by label"
          />
          <Tag className="pointer-events-none absolute top-1/2 right-2.5 h-3.5 w-3.5 -translate-y-1/2 text-text-3" />
        </span>
        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            className="text-[12.5px]"
            onClick={() => {
              setFilterAssignee("");
              setFilterPriority("");
              setFilterLabel("");
            }}
          >
            <X className="h-3.5 w-3.5" />
            Clear
          </Button>
        )}
      </div>

      {/* Columns */}
      <div className="flex-1 overflow-x-auto px-7 pt-5 pb-6 max-md:px-4">
        <DndContext
          sensors={sensors}
          collisionDetection={customCollisionDetection}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
        >
          <div className="flex h-full gap-3">
            {columns.map((column) => {
              const colCards = getFilteredCards(column.id);
              return (
                <div
                  key={column.id}
                  className="flex w-[264px] shrink-0 flex-col rounded-[10px] border border-border bg-surface-1"
                >
                  {/* Column header */}
                  <div className="flex h-11 shrink-0 items-center gap-2 pr-2.5 pl-3.5">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: column.color }} />
                    {renamingColumnId === column.id ? (
                      <input
                        type="text"
                        value={renameColumnName}
                        onChange={(e) => setRenameColumnName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleRenameColumn(column.id);
                          if (e.key === "Escape") { setRenamingColumnId(null); setRenameColumnName(""); }
                        }}
                        onBlur={() => { setRenamingColumnId(null); setRenameColumnName(""); }}
                        className="h-7 min-w-0 flex-1 rounded-md border border-border-strong bg-surface-2 px-2 text-[13px] font-medium text-text-1 focus:border-text-4 focus:outline-none"
                        autoFocus
                      />
                    ) : (
                      <>
                        <span className="truncate text-[13px] font-medium text-text-1">{column.name}</span>
                        <span className="font-mono text-[11px] text-text-3">{colCards.length}</span>
                        <span className="flex-1" />
                      </>
                    )}
                    <IconButton
                      onClick={(e) => {
                        e.stopPropagation();
                        const rect = e.currentTarget.getBoundingClientRect();
                        setColumnContextMenu({ columnId: column.id, x: rect.left, y: rect.bottom + 4 });
                      }}
                      size={24}
                      title="Column options"
                      aria-label={`${column.name} options`}
                    >
                      <Ellipsis className="h-[15px] w-[15px]" />
                    </IconButton>
                    <IconButton
                      onClick={() => {
                        setAddingCardColId(column.id);
                        setNewCardTitle("");
                      }}
                      size={24}
                      title="Add card"
                      aria-label={`Add card to ${column.name}`}
                    >
                      <Plus className="h-[15px] w-[15px]" />
                    </IconButton>
                  </div>

                  {/* Cards */}
                  <DroppableColumn columnId={column.id}>
                    <SortableContext
                      items={colCards.map((c) => c.id)}
                      strategy={verticalListSortingStrategy}
                    >
                      {colCards.map((card) => (
                        <SortableCard
                          key={card.id}
                          card={card}
                          selected={openCardId === card.id}
                          onClick={() => openCard(card.id)}
                        />
                      ))}
                    </SortableContext>

                    {/* Droppable area for empty columns */}
                    {colCards.length === 0 && addingCardColId !== column.id && (
                      <div className="flex h-16 shrink-0 items-center justify-center rounded-lg border border-dashed border-border-strong text-xs text-text-4">
                        Drop cards here
                      </div>
                    )}

                    {/* Add card form */}
                    {addingCardColId === column.id && (
                      <div className="rounded-lg border border-border-strong bg-surface-2 p-2">
                        <input
                          type="text"
                          value={newCardTitle}
                          onChange={(e) => setNewCardTitle(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleAddCard(column.id);
                            if (e.key === "Escape") setAddingCardColId(null);
                          }}
                          className="h-8 w-full rounded-md border border-border-strong bg-surface-1 px-2 text-[13px] text-text-1 placeholder:text-text-3 focus:border-text-4 focus:outline-none"
                          placeholder="Card title"
                          autoFocus
                        />
                        <div className="mt-2 flex gap-1.5">
                          <Button variant="primary" size="sm" className="h-7" onClick={() => handleAddCard(column.id)}>Add</Button>
                          <Button variant="ghost" size="sm" className="h-7" onClick={() => setAddingCardColId(null)}>Cancel</Button>
                        </div>
                      </div>
                    )}
                  </DroppableColumn>
                </div>
              );
            })}

            {/* Add column button */}
            {addingColumn ? (
              <div className="w-[264px] shrink-0 self-start rounded-[10px] border border-border bg-surface-1 p-2.5">
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
                  className="h-8 w-full rounded-md border border-border-strong bg-surface-2 px-2 text-[13px] text-text-1 placeholder:text-text-3 focus:border-text-4 focus:outline-none"
                  placeholder="Column name"
                  autoFocus
                />
                <div className="mt-2 flex gap-1.5">
                  <Button variant="primary" size="sm" className="h-7" onClick={handleAddColumn}>Add</Button>
                  <Button variant="ghost" size="sm" className="h-7" onClick={() => { setAddingColumn(false); setNewColumnName(""); }}>Cancel</Button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setAddingColumn(true)}
                className="flex h-11 w-[264px] shrink-0 items-center justify-center gap-2 self-start rounded-[10px] border border-dashed border-border-strong text-[13px] text-text-3 transition-colors hover:border-text-4 hover:text-text-2"
              >
                <Plus className="h-4 w-4" />
                Add column
              </button>
            )}

            {/* Room to scroll the last columns out from under the side panel. */}
            {openCardObj && <div aria-hidden className="w-[508px] shrink-0 max-md:hidden" />}
          </div>

          <DragOverlay>
            {activeCard ? (
              <div className="rotate-[1.5deg] shadow-[0_16px_40px_rgba(0,0,0,0.55)]">
                <KanbanCard card={activeCard} onClick={() => {}} />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>

      {/* Card side panel */}
      {openCardObj && cardView === "panel" && (
        <CardDetail
          key={openCardObj.id}
          mode="panel"
          {...cardDetailProps(openCardObj)}
          onMove={() => loadCards()}
        />
      )}

      {confirmAction && (
        <ConfirmModal title={confirmAction.title} message={confirmAction.message} onConfirm={confirmAction.action} onCancel={() => setConfirmAction(null)} />
      )}
    </div>
  );
}
