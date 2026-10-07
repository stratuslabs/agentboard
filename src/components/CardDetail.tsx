"use client";

import { useState, useEffect, useRef, useCallback, useLayoutEffect } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  Bot,
  Calendar,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CircleAlert,
  CircleDashed,
  Download,
  Ellipsis,
  FileText,
  GitPullRequest,
  Link2,
  LoaderCircle,
  Maximize2,
  Minimize2,
  Pencil,
  Plus,
  Signal,
  Tag,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import ConfirmModal from "./ConfirmModal";
import { Avatar, Button, Chip, GithubIcon, IconButton, MenuDivider, MenuItem, MenuPanel, cx } from "./ui";
import {
  type Card,
  type Column,
  type Member,
  PRIORITIES,
  cardLink,
  describeDue,
  formatDateTime,
  formatDueDate,
  formatRelative,
  getDueDateStatus,
  githubRef,
  parseLabels,
  priorityLabel,
} from "@/lib/cards";

interface Attachment {
  id: number;
  card_id: number;
  filename: string;
  content: string;
  created_at: string;
}

export interface CardContext {
  orgName?: string;
  productEmoji?: string;
  productName?: string;
  boardName?: string;
}

interface CardDetailProps {
  card: Card;
  mode: "panel" | "page";
  /** The board's columns, when the caller already has them. Fetched otherwise. */
  columns?: Column[];
  context: CardContext;
  /** The ordered list prev/next steps through, and what to call it ("Backlog"). */
  siblings?: Card[];
  siblingsLabel?: string;
  onNavigate: (card: Card) => void;
  onClose: () => void;
  onToggleMode: () => void;
  onUpdate: (card: Card) => void;
  onDelete: (cardId: number) => void;
  onMove?: (cardId: number, columnId: number) => void;
}

type TextField = "title" | "description" | "labels" | "github_issue_url" | "github_pr_url";
type SaveState = "idle" | "saving" | "saved" | "error";

const TEXT_SAVE_DELAY_MS = 600;
const PRIORITY_DOT: Record<string, string> = {
  urgent: "bg-priority-urgent",
  high: "bg-priority-high",
  medium: "bg-priority-medium",
  low: "bg-priority-low",
};

/** A textarea that grows with its content, so long titles and descriptions read as text. */
function AutoTextarea({ value, onChange, className, ...rest }: Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "onChange"> & { value: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cx("block w-full resize-none overflow-hidden bg-transparent focus:outline-none", className)}
      {...rest}
    />
  );
}

function PropRow({ icon, label, labelWidth, children }: { icon: React.ReactNode; label: string; labelWidth: number; children: React.ReactNode }) {
  return (
    <div className="flex min-h-[34px] items-center gap-2">
      <div className="flex shrink-0 items-center gap-2 text-[13px] text-text-3 [&>svg]:h-3.5 [&>svg]:w-3.5 [&>svg]:text-text-4" style={{ width: labelWidth }}>
        {icon}
        {label}
      </div>
      <div className="flex min-w-0 flex-1 items-center">{children}</div>
    </div>
  );
}

const VALUE_BOX = "relative inline-flex h-7 max-w-full min-w-0 items-center gap-[7px] rounded-md px-2 text-[13px] text-text-1 transition-colors hover:bg-surface-3 focus-within:bg-surface-3";
const VALUE_INPUT = "h-7 w-full rounded-md border border-border-strong bg-surface-2 px-2 text-[13px] text-text-1 placeholder:text-text-4 focus:border-text-4 focus:outline-none";
/** A native control laid over a styled value: keyboard and screen readers get the real thing. */
const OVERLAY_CONTROL = "absolute inset-0 h-full w-full cursor-pointer opacity-0";

function SectionHead({ title, count, children }: { title: string; count?: number; children?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <h3 className="text-xs font-semibold text-text-2">{title}</h3>
      {count !== undefined && <span className="font-mono text-[11px] text-text-4">{count}</span>}
      <span className="flex-1" />
      {children}
    </div>
  );
}

/** An editable URL property: a link when set, a prompt when empty, an input while editing. */
function LinkValue({ value, placeholder, icon, onCommit }: { value: string; placeholder: string; icon: React.ReactNode; onCommit: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  if (editing) {
    return (
      <input
        type="url"
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { setEditing(false); onCommit(draft.trim()); }}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.currentTarget.blur(); }
          if (e.key === "Escape") { e.stopPropagation(); setDraft(value); setEditing(false); }
        }}
        placeholder="https://github.com/…"
        className={VALUE_INPUT}
      />
    );
  }
  if (!value) {
    return (
      <button className={cx(VALUE_BOX, "text-text-4")} onClick={() => { setDraft(""); setEditing(true); }}>
        {placeholder}
      </button>
    );
  }
  const ref = githubRef(value);
  return (
    <span className="group/link inline-flex min-w-0 items-center gap-0.5">
      <a href={value} target="_blank" rel="noopener noreferrer" className={cx(VALUE_BOX, "min-w-0")} title={value}>
        <span className="text-text-3 [&>svg]:h-3 [&>svg]:w-3">{icon}</span>
        <span className={cx("truncate", ref && "font-mono text-[12.5px]")}>{ref ?? value.replace(/^https?:\/\//, "")}</span>
        <ArrowUpRight className="h-3 w-3 shrink-0 text-text-3" />
      </a>
      <IconButton size={24} aria-label={`Edit ${placeholder.toLowerCase()}`} className="opacity-0 group-hover/link:opacity-100 focus-visible:opacity-100"
        onClick={() => { setDraft(value); setEditing(true); }}>
        <Pencil className="h-3 w-3" />
      </IconButton>
    </span>
  );
}

export default function CardDetail({
  card,
  mode,
  columns,
  context,
  siblings,
  siblingsLabel,
  onNavigate,
  onClose,
  onToggleMode,
  onUpdate,
  onDelete,
  onMove,
}: CardDetailProps) {
  const [title, setTitle] = useState(card.title);
  const [description, setDescription] = useState(card.description || "");
  const [labels, setLabels] = useState(card.labels || "");
  const [githubIssueUrl, setGithubIssueUrl] = useState(card.github_issue_url || "");
  const [githubPrUrl, setGithubPrUrl] = useState(card.github_pr_url || "");
  const [assigneeId, setAssigneeId] = useState<number | null>(card.assignee_id || null);
  const [priority, setPriority] = useState(card.priority);
  const [dueDate, setDueDate] = useState(card.due_date ? card.due_date.slice(0, 10) : "");
  const [columnId, setColumnId] = useState<number>(card.column_id);
  const [fetchedColumns, setFetchedColumns] = useState<Column[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [newAttachmentName, setNewAttachmentName] = useState("");
  const [newAttachmentContent, setNewAttachmentContent] = useState("");
  const [showAddAttachment, setShowAddAttachment] = useState(false);
  const [editingLabels, setEditingLabels] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // --- Saving ---
  //
  // Every edit saves itself: selects and dates at once, text after a short
  // pause. Only the fields that changed are sent, so an edit here never writes
  // back a stale copy of something an agent changed in the meantime.
  //
  // `dirty` holds fields edited since their last successful save. Live updates
  // from the board refresh every other field, and leave these alone until the
  // save that carries them lands.
  const dirtyRef = useRef(new Set<string>());
  const pendingRef = useRef<Record<string, unknown>>({});
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // One save at a time. Edits made while a save is out wait in `pending` and
  // go together in the next request, so an older value can never land after
  // a newer one — two PATCHes in flight could otherwise finish in either order.
  const busyRef = useRef(false);
  const cardIdRef = useRef(card.id);
  const onUpdateRef = useRef(onUpdate);
  useEffect(() => { onUpdateRef.current = onUpdate; }, [onUpdate]);

  const flush = useCallback(async () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    if (busyRef.current) return; // the save in progress sends whatever is pending next
    busyRef.current = true;
    let failed = false;
    while (!failed && Object.keys(pendingRef.current).length > 0) {
      const body = pendingRef.current;
      pendingRef.current = {};
      setSaveState("saving");
      try {
        const res = await fetch(`/api/cards/${cardIdRef.current}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(String(res.status));
        const updated = await res.json();
        // The API names the assignee only when there is one; unassigning has
        // to clear the old name and colour, or a merge would keep them.
        if (updated.assignee_id == null) {
          updated.assignee_name = null;
          updated.assignee_type = null;
          updated.assignee_color = null;
        }
        onUpdateRef.current(updated);
        for (const key of Object.keys(body)) {
          if (!(key in pendingRef.current)) dirtyRef.current.delete(key);
        }
      } catch {
        // Put the failed fields back so the next edit, or closing, retries them.
        pendingRef.current = { ...body, ...pendingRef.current };
        failed = true;
        setSaveState("error");
      }
    }
    busyRef.current = false;
    if (!failed) setSaveState("saved");
  }, []);

  const queueSave = useCallback((fields: Record<string, unknown>, immediate: boolean) => {
    for (const key of Object.keys(fields)) dirtyRef.current.add(key);
    pendingRef.current = { ...pendingRef.current, ...fields };
    if (timerRef.current) clearTimeout(timerRef.current);
    if (immediate) void flush();
    else timerRef.current = setTimeout(() => void flush(), TEXT_SAVE_DELAY_MS);
  }, [flush]);

  // Closing, expanding or stepping to another card unmounts this; whatever is
  // still waiting on the debounce goes out first.
  useEffect(() => () => { void flush(); }, [flush]);

  // Fields not being edited follow the card as the board refreshes it.
  useEffect(() => {
    const d = dirtyRef.current;
    if (!d.has("title")) setTitle(card.title);
    if (!d.has("description")) setDescription(card.description || "");
    if (!d.has("labels")) setLabels(card.labels || "");
    if (!d.has("github_issue_url")) setGithubIssueUrl(card.github_issue_url || "");
    if (!d.has("github_pr_url")) setGithubPrUrl(card.github_pr_url || "");
    if (!d.has("assignee_id")) setAssigneeId(card.assignee_id || null);
    if (!d.has("priority")) setPriority(card.priority);
    if (!d.has("due_date")) setDueDate(card.due_date ? card.due_date.slice(0, 10) : "");
    setColumnId(card.column_id);
  }, [card]);

  function editText(field: TextField, value: string, set: (v: string) => void) {
    set(value);
    const normalized = field === "github_issue_url" || field === "github_pr_url" ? value || null : value;
    if (field === "title" && !value.trim()) return; // a card always keeps a title
    queueSave({ [field]: normalized }, false);
  }

  // --- Data the panel needs beyond the card ---
  const loadAttachments = useCallback(async () => {
    const res = await fetch(`/api/cards/${card.id}/attachments`);
    if (res.ok) setAttachments(await res.json());
  }, [card.id]);

  useEffect(() => { void loadAttachments(); }, [loadAttachments]);

  useEffect(() => {
    fetch("/api/members").then((r) => r.json()).then(setMembers).catch(() => {});
  }, []);

  // Columns come from the board when there is one; list views fetch the card's own.
  useEffect(() => {
    if (columns && columns.length > 0) return;
    fetch(`/api/columns/by-card/${card.id}`)
      .then((r) => r.ok ? r.json() : [])
      .then((cols) => { if (Array.isArray(cols)) setFetchedColumns(cols); })
      .catch(() => {});
  }, [columns, card.id]);

  // Escape leaves a field first, then closes.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape" || showDeleteConfirm) return;
      const active = document.activeElement as HTMLElement | null;
      if (active && rootRef.current?.contains(active) && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)) {
        active.blur();
        return;
      }
      if (menuOpen) { setMenuOpen(false); return; }
      onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, menuOpen, showDeleteConfirm]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menuOpen]);

  // --- Actions ---
  async function handleColumnChange(newColumnId: number) {
    if (newColumnId === card.column_id) {
      setColumnId(newColumnId);
      return;
    }
    setColumnId(newColumnId);
    try {
      const res = await fetch(`/api/cards/${card.id}/move`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ column_id: newColumnId }),
      });
      if (res.ok) {
        const moved = await res.json();
        onUpdate({ ...card, ...moved, assignee_name: card.assignee_name, assignee_type: card.assignee_type, assignee_color: card.assignee_color });
        if (onMove) onMove(card.id, newColumnId);
      } else {
        setColumnId(card.column_id);
      }
    } catch {
      setColumnId(card.column_id);
    }
  }

  async function handleDelete() {
    const res = await fetch(`/api/cards/${card.id}`, { method: "DELETE" });
    if (res.ok) {
      pendingRef.current = {};
      onDelete(card.id);
    }
  }

  async function handleAddAttachment() {
    if (!newAttachmentName.trim() || !newAttachmentContent.trim()) return;
    const res = await fetch(`/api/cards/${card.id}/attachments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: newAttachmentName.trim(),
        content: newAttachmentContent.trim(),
      }),
    });
    if (res.ok) {
      setNewAttachmentName("");
      setNewAttachmentContent("");
      setShowAddAttachment(false);
      loadAttachments();
    }
  }

  async function handleDeleteAttachment(attachmentId: number) {
    const res = await fetch(`/api/attachments/${attachmentId}`, { method: "DELETE" });
    if (res.ok) setAttachments((prev) => prev.filter((a) => a.id !== attachmentId));
  }

  function downloadAttachment(att: Attachment) {
    const url = URL.createObjectURL(new Blob([att.content], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = att.filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(cardLink(card.id));
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard can be denied; the URL bar already carries the link.
    }
  }

  // --- Derived ---
  const resolvedColumns = (columns && columns.length > 0) ? columns : fetchedColumns;
  const currentColumn = resolvedColumns.find((c) => c.id === columnId);
  const selectedMember = members.find((m) => m.id === assigneeId);
  const fallbackAssignee = !assigneeId && card.assignee ? card.assignee : null;
  const labelList = parseLabels(labels);
  const index = siblings ? siblings.findIndex((c) => c.id === card.id) : -1;
  const prev = index > 0 ? siblings![index - 1] : null;
  const next = index >= 0 && index < siblings!.length - 1 ? siblings![index + 1] : null;
  const dueStatus = dueDate ? getDueDateStatus(dueDate) : null;
  const isPage = mode === "page";
  const labelWidth = isPage ? 96 : 104;

  // --- Pieces shared by both layouts ---
  const saveIndicator = (
    <span className="flex items-center gap-1 pr-1.5 text-xs text-text-4" aria-live="polite">
      {saveState === "saving" && <><LoaderCircle className="h-3 w-3 animate-spin" />Saving</>}
      {saveState === "saved" && <><Check className="h-3 w-3" />Saved</>}
      {saveState === "error" && <span className="flex items-center gap-1 text-danger"><CircleAlert className="h-3 w-3" />Not saved</span>}
    </span>
  );

  const navButtons = (
    <>
      <IconButton size={28} aria-label="Previous card" title="Previous card" disabled={!prev} onClick={() => prev && onNavigate(prev)}>
        <ChevronUp className="h-[15px] w-[15px]" />
      </IconButton>
      <IconButton size={28} aria-label="Next card" title="Next card" disabled={!next} onClick={() => next && onNavigate(next)}>
        <ChevronDown className="h-[15px] w-[15px]" />
      </IconButton>
      <IconButton size={28} aria-label={isPage ? "Collapse to side panel" : "Open full page"} title={isPage ? "Collapse to side panel" : "Open full page"} onClick={onToggleMode}>
        {isPage ? <Minimize2 className="h-[15px] w-[15px]" /> : <Maximize2 className="h-[15px] w-[15px]" />}
      </IconButton>
      <IconButton size={28} aria-label="Copy link" title={copied ? "Copied" : "Copy link"} onClick={copyLink} className={copied ? "text-success" : undefined}>
        {copied ? <Check className="h-[15px] w-[15px]" /> : <Link2 className="h-[15px] w-[15px]" />}
      </IconButton>
      <span className="relative">
        <IconButton size={28} aria-label="More actions" aria-haspopup="menu" aria-expanded={menuOpen}
          onClick={(e) => { e.stopPropagation(); setMenuOpen((o) => !o); }} className={menuOpen ? "bg-surface-3 text-text-1" : undefined}>
          <Ellipsis className="h-[15px] w-[15px]" />
        </IconButton>
        {menuOpen && (
          <MenuPanel className="absolute top-8 right-0 w-48" onClick={(e) => e.stopPropagation()}>
            <MenuItem icon={<Link2 />} onClick={() => { setMenuOpen(false); void copyLink(); }}>Copy link</MenuItem>
            <MenuItem icon={isPage ? <Minimize2 /> : <Maximize2 />} onClick={() => { setMenuOpen(false); onToggleMode(); }}>
              {isPage ? "Open as side panel" : "Open full page"}
            </MenuItem>
            <MenuDivider />
            <MenuItem danger icon={<Trash2 />} onClick={() => { setMenuOpen(false); setShowDeleteConfirm(true); }}>Delete card</MenuItem>
          </MenuPanel>
        )}
      </span>
    </>
  );

  const properties = (
    <div className="flex flex-col gap-0.5">
      <PropRow icon={<CircleDashed />} label="Status" labelWidth={labelWidth}>
        {resolvedColumns.length > 0 ? (
          <span className={VALUE_BOX}>
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: currentColumn?.color }} />
            <span className="truncate">{currentColumn?.name ?? "—"}</span>
            <ChevronDown className="h-3 w-3 shrink-0 text-text-4" />
            <select aria-label="Status" value={columnId} onChange={(e) => handleColumnChange(Number(e.target.value))} className={OVERLAY_CONTROL}>
              {resolvedColumns.map((col) => <option key={col.id} value={col.id}>{col.name}</option>)}
            </select>
          </span>
        ) : (
          <span className={cx(VALUE_BOX, "text-text-4")}>—</span>
        )}
      </PropRow>

      <PropRow icon={<UserRound />} label="Assignee" labelWidth={labelWidth}>
        <span className="flex min-w-0 flex-col">
          <span className={VALUE_BOX}>
            {selectedMember ? (
              <>
                <Avatar name={selectedMember.name} color={selectedMember.color} size={18} />
                <span className="truncate">{selectedMember.name}</span>
                {selectedMember.type === "agent" && <Bot aria-label="Agent" className="h-3 w-3 shrink-0 text-silver" />}
              </>
            ) : (
              <span className="text-text-4">Unassigned</span>
            )}
            <select aria-label="Assignee" value={assigneeId ?? ""} className={OVERLAY_CONTROL}
              onChange={(e) => {
                const v = e.target.value ? Number(e.target.value) : null;
                setAssigneeId(v);
                queueSave({ assignee_id: v, assignee: null }, true);
              }}>
              <option value="">Unassigned</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>{m.name}{m.type === "agent" ? " (agent)" : ""}</option>
              ))}
            </select>
          </span>
          {fallbackAssignee && <span className="px-2 text-[11.5px] text-text-4">Legacy: {fallbackAssignee}</span>}
        </span>
      </PropRow>

      <PropRow icon={<Signal />} label="Priority" labelWidth={labelWidth}>
        <span className={VALUE_BOX}>
          <span className={cx("h-2 w-2 shrink-0 rounded-full", PRIORITY_DOT[priority] || PRIORITY_DOT.medium)} />
          {priorityLabel(priority)}
          <select aria-label="Priority" value={priority} className={OVERLAY_CONTROL}
            onChange={(e) => { setPriority(e.target.value); queueSave({ priority: e.target.value }, true); }}>
            {[...PRIORITIES].reverse().map((p) => <option key={p} value={p}>{priorityLabel(p)}</option>)}
          </select>
        </span>
      </PropRow>

      <PropRow icon={<Calendar />} label="Due date" labelWidth={labelWidth}>
        <span className="group/due inline-flex items-center gap-0.5">
          <span className={VALUE_BOX}>
            {dueDate ? (
              <>
                <span className={dueStatus === "overdue" ? "text-danger" : dueStatus === "today" ? "text-warn" : undefined}>{formatDueDate(dueDate)}</span>
                <span className="text-text-3">{describeDue(dueDate)}</span>
              </>
            ) : (
              <span className="text-text-4">Set due date</span>
            )}
            <input type="date" aria-label="Due date" value={dueDate} className={cx(OVERLAY_CONTROL, "[color-scheme:dark]")}
              onClick={(e) => { try { e.currentTarget.showPicker(); } catch { /* not supported */ } }}
              onChange={(e) => { setDueDate(e.target.value); queueSave({ due_date: e.target.value || null }, true); }} />
          </span>
          {dueDate && (
            <IconButton size={24} aria-label="Clear due date" className="opacity-0 group-hover/due:opacity-100 focus-visible:opacity-100"
              onClick={() => { setDueDate(""); queueSave({ due_date: null }, true); }}>
              <X className="h-3 w-3" />
            </IconButton>
          )}
        </span>
      </PropRow>

      <PropRow icon={<Tag />} label="Labels" labelWidth={labelWidth}>
        {editingLabels ? (
          <input
            autoFocus
            value={labels}
            onChange={(e) => editText("labels", e.target.value, setLabels)}
            onBlur={() => { setEditingLabels(false); void flush(); }}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") { e.stopPropagation(); e.currentTarget.blur(); } }}
            placeholder="bug, frontend, v2"
            aria-label="Labels, comma-separated"
            className={VALUE_INPUT}
          />
        ) : (
          <button onClick={() => setEditingLabels(true)} className={cx(VALUE_BOX, "h-auto min-h-7 flex-wrap py-1")} aria-label="Edit labels">
            {labelList.length > 0 ? labelList.map((l) => <Chip key={l}>{l}</Chip>) : <span className="text-text-4">Add labels</span>}
            <Plus className="h-[13px] w-[13px] text-text-3" />
          </button>
        )}
      </PropRow>

      <PropRow icon={<GithubIcon />} label="Issue" labelWidth={labelWidth}>
        <LinkValue value={githubIssueUrl} placeholder={isPage ? "Link issue" : "Link GitHub issue"} icon={<GithubIcon />}
          onCommit={(v) => { if (v !== githubIssueUrl) editText("github_issue_url", v, setGithubIssueUrl); void flush(); }} />
      </PropRow>

      <PropRow icon={<GitPullRequest />} label={isPage ? "PR" : "Pull request"} labelWidth={labelWidth}>
        <LinkValue value={githubPrUrl} placeholder={isPage ? "Link PR" : "Link pull request"} icon={<GitPullRequest />}
          onCommit={(v) => { if (v !== githubPrUrl) editText("github_pr_url", v, setGithubPrUrl); void flush(); }} />
      </PropRow>
    </div>
  );

  const titleField = (
    <AutoTextarea
      value={title}
      onChange={(v) => editText("title", v, setTitle)}
      onBlur={() => { if (!title.trim()) setTitle(card.title); void flush(); }}
      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } }}
      aria-label="Title"
      placeholder="Card title"
      className={cx(
        "font-semibold text-text-1 placeholder:text-text-4",
        isPage ? "text-[30px] leading-[1.2] tracking-[-0.8px]" : "text-[21px] leading-[1.3] tracking-[-0.4px]",
      )}
    />
  );

  const descriptionField = (
    <div className="flex flex-col gap-2.5">
      {!isPage && <SectionHead title="Description" />}
      <AutoTextarea
        value={description}
        onChange={(v) => editText("description", v, setDescription)}
        onBlur={() => void flush()}
        aria-label="Description"
        placeholder="Add a description…"
        className={cx(
          "-mx-2 rounded-md px-2 py-1 text-text-1 transition-colors placeholder:text-text-4 hover:bg-surface-1 focus:bg-surface-1",
          isPage ? "min-h-[3em] text-[15px] leading-[1.7]" : "min-h-[2.5em] text-[14px] leading-[1.65]",
        )}
      />
    </div>
  );

  const attachmentsSection = (
    <div className="flex flex-col gap-2.5">
      <SectionHead title="Attachments" count={attachments.length}>
        <Button variant="ghost" size="sm" className="h-6 px-1.5 text-xs" onClick={() => setShowAddAttachment(!showAddAttachment)}>
          {showAddAttachment ? "Cancel" : <><Plus className="h-3 w-3" />Add</>}
        </Button>
      </SectionHead>

      {attachments.map((att) => (
        <div key={att.id} className="group/att flex items-center gap-3 rounded-lg border border-border-strong bg-surface-1 py-2 pr-2 pl-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-surface-3 text-text-2">
            <FileText className="h-4 w-4" />
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[13px] text-text-1">{att.filename}</span>
            <span className="text-[11.5px] text-text-3">
              {Math.max(1, Math.round(new Blob([att.content]).size / 1024))} KB · {formatRelative(att.created_at)}
            </span>
          </span>
          <IconButton size={28} aria-label={`Download ${att.filename}`} title="Download" onClick={() => downloadAttachment(att)}>
            <Download className="h-[15px] w-[15px]" />
          </IconButton>
          <IconButton size={28} aria-label={`Delete ${att.filename}`} title="Delete" onClick={() => handleDeleteAttachment(att.id)} className="hover:text-danger">
            <Trash2 className="h-[15px] w-[15px]" />
          </IconButton>
        </div>
      ))}

      {attachments.length === 0 && !showAddAttachment && (
        <button onClick={() => setShowAddAttachment(true)}
          className="flex h-[52px] items-center justify-center gap-2 rounded-lg border border-dashed border-border-strong bg-surface-1 text-[12.5px] text-text-3 transition-colors hover:border-text-4 hover:text-text-2">
          <Plus className="h-3.5 w-3.5" />
          Add a text attachment
        </button>
      )}

      {showAddAttachment && (
        <div className="flex flex-col gap-2 rounded-lg border border-border-strong bg-surface-1 p-3">
          <input
            type="text"
            autoFocus
            value={newAttachmentName}
            onChange={(e) => setNewAttachmentName(e.target.value)}
            className={cx(VALUE_INPUT, "h-8")}
            placeholder="Filename"
          />
          <textarea
            value={newAttachmentContent}
            onChange={(e) => setNewAttachmentContent(e.target.value)}
            rows={3}
            className={cx(VALUE_INPUT, "h-auto resize-y py-1.5 font-mono text-[12px] leading-relaxed")}
            placeholder="Content"
          />
          <div className="flex gap-1.5">
            <Button variant="primary" size="sm" onClick={handleAddAttachment} disabled={!newAttachmentName.trim() || !newAttachmentContent.trim()}>Add</Button>
            <Button variant="ghost" size="sm" onClick={() => setShowAddAttachment(false)}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  );

  const deleteConfirm = showDeleteConfirm && (
    <ConfirmModal title="Delete card" message="This card will be permanently deleted." onConfirm={handleDelete} onCancel={() => setShowDeleteConfirm(false)} />
  );

  // --- Full page ---
  if (isPage) {
    return (
      <div ref={rootRef} className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border pr-4 pl-7 text-[13px] max-md:pl-3">
          <IconButton size={28} aria-label="Back to board" title="Back" onClick={onClose} className="-ml-1.5">
            <ArrowLeft className="h-[15px] w-[15px]" />
          </IconButton>
          <span className="flex min-w-0 items-center gap-2 text-text-3 max-md:hidden">
            {context.orgName && <><span className="truncate">{context.orgName}</span><ChevronRight className="h-3 w-3 shrink-0 text-text-4" /></>}
            {context.productName && <><span className="truncate">{context.productEmoji} {context.productName}</span><ChevronRight className="h-3 w-3 shrink-0 text-text-4" /></>}
            {context.boardName && <><span className="truncate">{context.boardName}</span><ChevronRight className="h-3 w-3 shrink-0 text-text-4" /></>}
          </span>
          <span className="font-mono text-xs text-text-2">#{card.id}</span>
          <span className="flex-1" />
          {saveIndicator}
          {siblings && index >= 0 && siblingsLabel && (
            <span className="pr-1 text-xs text-text-4 max-md:hidden">{index + 1} of {siblings.length} in {siblingsLabel}</span>
          )}
          {navButtons}
        </div>

        <div className="flex min-h-0 flex-1 max-lg:flex-col max-lg:overflow-y-auto">
          <div className="min-w-0 flex-1 overflow-y-auto px-[72px] pt-11 pb-10 max-lg:overflow-visible max-md:px-5">
            <div className="flex max-w-[640px] flex-col gap-7">
              {titleField}
              {descriptionField}
              {attachmentsSection}
            </div>
          </div>

          <aside className="flex w-[340px] shrink-0 flex-col gap-5 border-l border-border bg-bg-sidebar px-5 py-7 max-lg:w-full max-lg:border-t max-lg:border-l-0">
            <h2 className="font-mono text-[10.5px] tracking-[0.8px] text-text-4 uppercase">Properties</h2>
            {properties}
            <div className="h-px bg-border" />
            <dl className="grid grid-cols-[96px_1fr] gap-x-2 gap-y-2 text-xs">
              <dt className="text-text-3">Created</dt>
              <dd className="font-mono text-text-2">{formatDateTime(card.created_at)}</dd>
              <dt className="text-text-3">Updated</dt>
              <dd className="font-mono text-text-2">{formatDateTime(card.updated_at)}</dd>
            </dl>
            <span className="flex-1" />
            <Button variant="danger-ghost" size="sm" className="self-start" onClick={() => setShowDeleteConfirm(true)}>
              <Trash2 className="h-3.5 w-3.5" />
              Delete card
            </Button>
          </aside>
        </div>
        {deleteConfirm}
      </div>
    );
  }

  // --- Side panel ---
  return (
    <div
      ref={rootRef}
      role="complementary"
      aria-label={`Card #${card.id}`}
      className="slide-in-right fixed top-0 right-0 bottom-0 z-40 flex w-[520px] max-w-full flex-col border-l border-border-strong bg-bg-sidebar shadow-[-16px_0_48px_rgba(0,0,0,0.5)]"
    >
      <div className="flex h-[52px] shrink-0 items-center gap-1.5 border-b border-border pr-2.5 pl-5 text-[13px]">
        {context.productName && (
          <span className="flex min-w-0 items-center gap-1.5 text-text-2">
            <span>{context.productEmoji}</span>
            <span className="truncate">{context.productName}</span>
            {context.boardName && <><ChevronRight className="h-3 w-3 shrink-0 text-text-4" /><span className="truncate">{context.boardName}</span></>}
          </span>
        )}
        <span className="font-mono text-[11px] text-text-4">#{card.id}</span>
        <span className="flex-1" />
        {saveIndicator}
        {navButtons}
        <IconButton size={28} aria-label="Close" title="Close" onClick={onClose}>
          <X className="h-[15px] w-[15px]" />
        </IconButton>
      </div>

      <div className="flex flex-1 flex-col gap-6 overflow-y-auto px-6 pt-[22px] pb-6">
        {titleField}
        {properties}
        <div className="h-px shrink-0 bg-border" />
        {descriptionField}
        {attachmentsSection}
        <p className="text-xs text-text-3">
          Created {formatDateTime(card.created_at)} · Updated {formatRelative(card.updated_at)}
        </p>
      </div>
      {deleteConfirm}
    </div>
  );
}
