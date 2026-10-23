"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Plus, Trash2 } from "lucide-react";
import { IconButton, cx } from "./ui";
import {
  MAX_SUBTASK_TITLE,
  type Subtask,
  restoreSubtask,
  revertSubtaskPatch,
  subtaskProgress,
} from "@/lib/subtasks";

interface SubtasksProps {
  cardId: number;
  /** The card's updated_at. Every sub-task write bumps it, so a change made
   *  elsewhere (the CLI, another tab) reloads the list here. */
  cardUpdatedAt: string;
}

const ROW = "group/sub flex min-h-8 items-center gap-2.5 rounded-md px-1.5 transition-colors hover:bg-surface-3";
const TITLE_INPUT =
  "h-7 min-w-0 flex-1 rounded-md border border-border-strong bg-surface-2 px-2 text-[13px] text-text-1 placeholder:text-text-4 focus:border-text-4 focus:outline-none";

/** A checkbox styled like the rest of the card, over a real input so keyboard and screen readers get the real thing. */
function Checkbox({ checked, label, onChange }: { checked: boolean; label: string; onChange: (v: boolean) => void }) {
  return (
    <span className="relative flex h-4 w-4 shrink-0 items-center justify-center">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        aria-label={label}
        className="peer absolute inset-0 h-full w-full cursor-pointer opacity-0"
      />
      <span
        aria-hidden
        className={cx(
          "pointer-events-none flex h-4 w-4 items-center justify-center rounded-[4px] border transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-text-4",
          checked ? "border-success bg-success text-on-ivory" : "border-text-4 bg-transparent",
        )}
      >
        {checked && <Check className="h-3 w-3" strokeWidth={3} />}
      </span>
    </span>
  );
}

function SubtaskRow({
  subtask,
  onToggle,
  onRename,
  onDelete,
}: {
  subtask: Subtask;
  onToggle: (done: boolean) => void;
  onRename: (title: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(subtask.title);
  const cancelRef = useRef(false);

  function commit() {
    setEditing(false);
    if (cancelRef.current) { cancelRef.current = false; setDraft(subtask.title); return; }
    const next = draft.trim();
    if (next && next !== subtask.title) onRename(next);
    else setDraft(subtask.title);
  }

  return (
    <li className={ROW}>
      <Checkbox checked={subtask.done} label={`Done: ${subtask.title}`} onChange={onToggle} />
      {editing ? (
        <input
          autoFocus
          value={draft}
          maxLength={MAX_SUBTASK_TITLE}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); }
            if (e.key === "Escape") cancelRef.current = true; // the card's Escape handler blurs
          }}
          aria-label="Sub-task title"
          className={TITLE_INPUT}
        />
      ) : (
        <button
          type="button"
          onClick={() => { setDraft(subtask.title); setEditing(true); }}
          title="Rename"
          className={cx(
            "min-w-0 flex-1 cursor-text py-1 text-left text-[13px] leading-[1.45] break-words",
            subtask.done ? "text-text-3 line-through decoration-text-4" : "text-text-1",
          )}
        >
          {subtask.title}
        </button>
      )}
      <IconButton
        size={24}
        aria-label={`Delete sub-task: ${subtask.title}`}
        title="Delete"
        onClick={onDelete}
        className="opacity-0 group-hover/sub:opacity-100 focus-visible:opacity-100 hover:text-danger max-md:opacity-100"
      >
        <Trash2 className="h-[13px] w-[13px]" />
      </IconButton>
    </li>
  );
}

export default function Subtasks({ cardId, cardUpdatedAt }: SubtasksProps) {
  const [subtasks, setSubtasks] = useState<Subtask[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Writes in flight. A reload that lands mid-write would show the old value,
  // so a reload asked for during a write is queued and runs once local writes
  // have settled, instead of being dropped.
  const inFlight = useRef(0);
  const reloadQueued = useRef(false);
  // Only the latest load may set the list; an older response is stale.
  const loadSeq = useRef(0);

  const load = useCallback(async () => {
    if (inFlight.current > 0) { reloadQueued.current = true; return; }
    const seq = ++loadSeq.current;
    try {
      const res = await fetch(`/api/cards/${cardId}/subtasks`);
      if (!res.ok) return;
      const list: Subtask[] = await res.json();
      if (seq !== loadSeq.current) return;
      // A write started while this was loading: its result is newer.
      if (inFlight.current > 0) { reloadQueued.current = true; return; }
      setSubtasks(list);
    } catch {
      // keep what we have; the next change reloads
    } finally {
      setLoaded(true);
    }
  }, [cardId]);

  useEffect(() => { void load(); }, [load, cardUpdatedAt]);

  async function write(run: () => Promise<Response>, rollback: () => void) {
    inFlight.current++;
    setError(null);
    try {
      const res = await run();
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Request failed (${res.status})`);
      }
      return await res.json();
    } catch (e) {
      // Undo just this write, then check the server once writes settle: it
      // may have applied the change after all.
      rollback();
      reloadQueued.current = true;
      setError(e instanceof Error ? e.message : "Couldn't save the sub-task");
      return null;
    } finally {
      inFlight.current--;
      if (inFlight.current === 0 && reloadQueued.current) {
        reloadQueued.current = false;
        void load();
      }
    }
  }

  async function add() {
    const title = newTitle.trim();
    if (!title) return;
    setNewTitle("");
    const created = await write(
      () => fetch(`/api/cards/${cardId}/subtasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      }),
      () => setNewTitle(title),
    );
    if (created) setSubtasks((prev) => [...prev, created]);
  }

  async function update(id: number, patch: Partial<Pick<Subtask, "title" | "done">>) {
    const before = subtasks.find((s) => s.id === id);
    if (!before) return;
    setSubtasks((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
    const saved = await write(
      () => fetch(`/api/subtasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      }),
      () => setSubtasks((prev) => revertSubtaskPatch(prev, before, patch)),
    );
    if (saved) setSubtasks((prev) => prev.map((s) => (s.id === id ? saved : s)));
  }

  async function remove(id: number) {
    const before = subtasks.find((s) => s.id === id);
    if (!before) return;
    setSubtasks((prev) => prev.filter((s) => s.id !== id));
    await write(
      () => fetch(`/api/subtasks/${id}`, { method: "DELETE" }),
      () => setSubtasks((prev) => restoreSubtask(prev, before)),
    );
  }

  const doneCount = subtasks.filter((s) => s.done).length;
  const progress = subtaskProgress(subtasks.length, doneCount);

  return (
    <div className="flex flex-col gap-2" aria-label="Sub-tasks" role="group">
      <div className="flex items-center gap-2">
        <h3 className="text-xs font-semibold text-text-2">Sub-tasks</h3>
        {progress && (
          <span className={cx("font-mono text-[11px]", doneCount === subtasks.length ? "text-success" : "text-text-4")}>
            {progress}
          </span>
        )}
        <span className="flex-1" />
      </div>

      {subtasks.length > 0 && (
        <>
          <div className="h-1 overflow-hidden rounded-full bg-surface-3" aria-hidden>
            <div
              className="h-full rounded-full bg-success transition-[width] duration-200"
              style={{ width: `${(doneCount / subtasks.length) * 100}%` }}
            />
          </div>
          <ul className="-mx-1.5 flex flex-col">
            {subtasks.map((s) => (
              <SubtaskRow
                key={s.id}
                subtask={s}
                onToggle={(done) => update(s.id, { done })}
                onRename={(title) => update(s.id, { title })}
                onDelete={() => remove(s.id)}
              />
            ))}
          </ul>
        </>
      )}

      {adding ? (
        <form
          className="flex items-center gap-2.5 px-0"
          onSubmit={(e) => { e.preventDefault(); void add(); }}
        >
          <Plus className="h-4 w-4 shrink-0 text-text-4" />
          <input
            autoFocus
            value={newTitle}
            maxLength={MAX_SUBTASK_TITLE}
            onChange={(e) => setNewTitle(e.target.value)}
            onBlur={() => { if (!newTitle.trim()) setAdding(false); }}
            placeholder="Add a sub-task, Enter to save"
            aria-label="New sub-task"
            className={TITLE_INPUT}
          />
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          disabled={!loaded}
          className="-mx-1.5 flex h-8 items-center gap-2.5 rounded-md px-1.5 text-[13px] text-text-3 transition-colors hover:bg-surface-3 hover:text-text-2"
        >
          <Plus className="h-4 w-4" />
          Add sub-task
        </button>
      )}

      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    </div>
  );
}
