"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, ChevronUp, Plus, X } from "lucide-react";
import { Button, IconButton, cx } from "../ui";
import { DEFAULT_COLUMNS } from "../../lib/default-columns";
import { saveSetting } from "../../lib/settings-save";

interface ColumnDef {
  name: string;
  color: string;
}

const FALLBACK_BOARDS = ["Development", "Marketing", "Sales", "Support"];
const FALLBACK_COLUMNS: ColumnDef[] = DEFAULT_COLUMNS;

function useSetting<T>(key: string, fallback: T) {
  const [value, setValue] = useState<T | null>(null);
  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => setValue((data[key] as T) || fallback))
      .catch(() => setValue(fallback));
    // fallback is a module constant; key never changes for a mounted section
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return [value, setValue] as const;
}

type SaveState = { kind: "idle" } | { kind: "saving" } | { kind: "saved" } | { kind: "error"; message: string };

/**
 * Saves one setting. "Saved" only shows when the server stored it; a failed
 * save shows why and leaves the list as edited, so Save can simply be retried.
 */
function useSaver(key: string) {
  const [state, setState] = useState<SaveState>({ kind: "idle" });
  const attempt = useRef(0);
  async function save(value: unknown) {
    const mine = ++attempt.current;
    setState({ kind: "saving" });
    const result = await saveSetting(key, value);
    if (mine !== attempt.current) return;
    if (!result.ok) {
      setState({ kind: "error", message: result.message });
      return;
    }
    setState({ kind: "saved" });
    setTimeout(() => { if (mine === attempt.current) setState({ kind: "idle" }); }, 2000);
  }
  return { state, save };
}

function move<T>(list: T[], i: number, dir: -1 | 1): T[] {
  const j = i + dir;
  if (j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

function ListRow({ index, count, onMove, onRemove, children }: {
  index: number; count: number; onMove: (dir: -1 | 1) => void; onRemove: () => void; children: React.ReactNode;
}) {
  return (
    <div className="group/row flex h-11 items-center gap-2.5 border-b border-border pr-3 pl-2.5 transition-colors last:border-b-0 focus-within:bg-surface-2 hover:bg-surface-2">
      <div className="flex flex-col opacity-0 transition-opacity group-focus-within/row:opacity-100 group-hover/row:opacity-100">
        <button onClick={() => onMove(-1)} disabled={index === 0} aria-label="Move up" className="text-text-3 hover:text-text-1 disabled:opacity-30">
          <ChevronUp className="h-3 w-3" />
        </button>
        <button onClick={() => onMove(1)} disabled={index === count - 1} aria-label="Move down" className="text-text-3 hover:text-text-1 disabled:opacity-30">
          <ChevronDown className="h-3 w-3" />
        </button>
      </div>
      {children}
      <IconButton size={24} onClick={onRemove} aria-label="Remove" title="Remove"
        className="text-danger opacity-0 group-focus-within/row:opacity-100 group-hover/row:opacity-100 hover:bg-danger/12 hover:text-danger">
        <X className="h-3.5 w-3.5" />
      </IconButton>
    </div>
  );
}

function Footer({ addLabel, onAdd, state, onSave }: { addLabel: string; onAdd: () => void; state: SaveState; onSave: () => void }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={onAdd}><Plus className="h-3.5 w-3.5" />{addLabel}</Button>
        <Button variant="primary" onClick={onSave} disabled={state.kind === "saving"}>
          {state.kind === "saving" ? "Saving…" : state.kind === "saved" ? <><Check className="h-3.5 w-3.5" />Saved</> : "Save"}
        </Button>
      </div>
      {state.kind === "error" && <p role="alert" className="text-right text-xs text-danger">{state.message}</p>}
    </div>
  );
}

const ROW_INPUT = "min-w-0 flex-1 bg-transparent text-[13.5px] text-text-1 placeholder:text-text-4 focus:outline-none";

export function DefaultBoards() {
  const [boards, setBoards] = useSetting<string[]>("default_boards", FALLBACK_BOARDS);
  const { state, save } = useSaver("default_boards");
  if (!boards) return <div className="text-xs text-text-3">Loading…</div>;
  return (
    <>
      <div className="overflow-hidden rounded-[10px] border border-border bg-surface-1">
        {boards.map((board, i) => (
          <ListRow key={i} index={i} count={boards.length} onMove={(d) => setBoards(move(boards, i, d))} onRemove={() => setBoards(boards.filter((_, j) => j !== i))}>
            <input value={board} aria-label="Board name" placeholder="Board name" className={ROW_INPUT}
              onChange={(e) => { const next = [...boards]; next[i] = e.target.value; setBoards(next); }} />
          </ListRow>
        ))}
      </div>
      <Footer addLabel="Add board" onAdd={() => setBoards([...boards, ""])} state={state} onSave={() => save(boards.filter((b) => b.trim()))} />
    </>
  );
}

export function DefaultColumns() {
  const [columns, setColumns] = useSetting<ColumnDef[]>("default_columns", FALLBACK_COLUMNS);
  const { state, save } = useSaver("default_columns");
  if (!columns) return <div className="text-xs text-text-3">Loading…</div>;
  return (
    <>
      <div className="overflow-hidden rounded-[10px] border border-border bg-surface-1">
        {columns.map((col, i) => (
          <ListRow key={i} index={i} count={columns.length} onMove={(d) => setColumns(move(columns, i, d))} onRemove={() => setColumns(columns.filter((_, j) => j !== i))}>
            <span className="relative h-[18px] w-[18px] shrink-0">
              <span className={cx("absolute inset-0 rounded-full border border-white/10")} style={{ backgroundColor: col.color }} />
              <input type="color" value={col.color} aria-label={`${col.name || "Column"} color`} className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                onChange={(e) => { const next = [...columns]; next[i] = { ...next[i], color: e.target.value }; setColumns(next); }} />
            </span>
            <input value={col.name} aria-label="Column name" placeholder="Column name" className={ROW_INPUT}
              onChange={(e) => { const next = [...columns]; next[i] = { ...next[i], name: e.target.value }; setColumns(next); }} />
          </ListRow>
        ))}
      </div>
      <Footer addLabel="Add column" onAdd={() => setColumns([...columns, { name: "", color: "#6B7280" }])} state={state} onSave={() => save(columns.filter((c) => c.name.trim()))} />
      <p className="text-xs text-text-4">These columns will be created in every new board for new products.</p>
    </>
  );
}
