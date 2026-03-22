"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import ConfirmModal from "./ConfirmModal";

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

interface Member {
  id: number;
  name: string;
  type: string;
  color: string;
}

interface Attachment {
  id: number;
  card_id: number;
  filename: string;
  content: string;
  created_at: string;
}

interface CardModalProps {
  card: Card;
  onClose: () => void;
  onUpdate: (card: Card) => void;
  onDelete: (cardId: number) => void;
}

export default function CardModal({
  card,
  onClose,
  onUpdate,
  onDelete,
}: CardModalProps) {
  const [title, setTitle] = useState(card.title);
  const [description, setDescription] = useState(card.description || "");
  const [assigneeId, setAssigneeId] = useState<number | null>(card.assignee_id || null);
  const [priority, setPriority] = useState(card.priority);
  const [dueDate, setDueDate] = useState(card.due_date ? card.due_date.slice(0, 10) : "");
  const [labels, setLabels] = useState(card.labels || "");
  const [githubIssueUrl, setGithubIssueUrl] = useState(
    card.github_issue_url || ""
  );
  const [githubPrUrl, setGithubPrUrl] = useState(card.github_pr_url || "");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [newAttachmentName, setNewAttachmentName] = useState("");
  const [newAttachmentContent, setNewAttachmentContent] = useState("");
  const [showAddAttachment, setShowAddAttachment] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const overlayRef = useRef<HTMLDivElement>(null);

  const loadAttachments = useCallback(async () => {
    const res = await fetch(`/api/cards/${card.id}/attachments`);
    if (res.ok) {
      setAttachments(await res.json());
    }
  }, [card.id]);

  useEffect(() => {
    loadAttachments();
  }, [loadAttachments]);

  useEffect(() => {
    fetch("/api/members")
      .then((r) => r.json())
      .then(setMembers)
      .catch(() => {});
  }, []);

  useEffect(() => {
    function handleEsc(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [onClose]);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch(`/api/cards/${card.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          description,
          assignee_id: assigneeId,
          assignee: assigneeId ? null : null,
          priority,
          due_date: dueDate || null,
          labels,
          github_issue_url: githubIssueUrl || null,
          github_pr_url: githubPrUrl || null,
        }),
      });
      if (res.ok) {
        const updated = await res.json();
        onUpdate(updated);
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    const res = await fetch(`/api/cards/${card.id}`, { method: "DELETE" });
    if (res.ok) {
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
    const res = await fetch(`/api/attachments/${attachmentId}`, {
      method: "DELETE",
    });
    if (res.ok) {
      setAttachments((prev) => prev.filter((a) => a.id !== attachmentId));
    }
  }

  function handleOverlayClick(e: React.MouseEvent) {
    if (e.target === overlayRef.current) onClose();
  }

  const selectedMember = members.find((m) => m.id === assigneeId);
  const fallbackAssignee = !assigneeId && card.assignee ? card.assignee : null;

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 backdrop-blur-sm overflow-y-auto py-12"
    >
      <div className="w-full max-w-2xl bg-surface-800 rounded-xl border border-surface-600 shadow-2xl fade-in">
        {/* Header */}
        <div className="flex items-start justify-between px-6 pt-5 pb-3">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="text-lg font-semibold text-white bg-transparent border-none outline-none flex-1 mr-4 focus:ring-0"
            placeholder="Card title"
          />
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg hover:bg-surface-600 flex items-center justify-center text-gray-400 hover:text-white transition-colors shrink-0"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <div className="px-6 pb-6 space-y-4">
          {/* Description */}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              className="w-full px-3 py-2 bg-surface-700 border border-surface-500 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-accent resize-y"
              placeholder="Markdown description..."
            />
          </div>

          {/* Row: Assignee + Priority */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">
                Assignee
              </label>
              <select
                value={assigneeId ?? ""}
                onChange={(e) => setAssigneeId(e.target.value ? Number(e.target.value) : null)}
                className="w-full px-3 py-2 bg-surface-700 border border-surface-500 rounded-lg text-sm text-white focus:outline-none focus:ring-1 focus:ring-accent"
              >
                <option value="">Unassigned</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}{m.type === "agent" ? " \u{1F916}" : ""}
                  </option>
                ))}
              </select>
              {selectedMember && (
                <div className="flex items-center gap-1.5 mt-1.5">
                  <div
                    className="w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-semibold text-white"
                    style={{ backgroundColor: selectedMember.color }}
                  >
                    {selectedMember.name.charAt(0).toUpperCase()}
                  </div>
                  <span className="text-xs text-gray-400">{selectedMember.name}</span>
                  {selectedMember.type === "agent" && <span className="text-[10px]">{"\u{1F916}"}</span>}
                </div>
              )}
              {fallbackAssignee && (
                <div className="text-xs text-gray-500 mt-1">
                  Legacy: {fallbackAssignee}
                </div>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">
                Priority
              </label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                className="w-full px-3 py-2 bg-surface-700 border border-surface-500 rounded-lg text-sm text-white focus:outline-none focus:ring-1 focus:ring-accent"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
          </div>

          {/* Due Date */}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">
              Due Date
            </label>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="w-full px-3 py-2 bg-surface-700 border border-surface-500 rounded-lg text-sm text-white focus:outline-none focus:ring-1 focus:ring-accent [color-scheme:dark]"
            />
          </div>

          {/* Labels */}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">
              Labels (comma-separated)
            </label>
            <input
              type="text"
              value={labels}
              onChange={(e) => setLabels(e.target.value)}
              className="w-full px-3 py-2 bg-surface-700 border border-surface-500 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-accent"
              placeholder="bug, frontend, v2"
            />
          </div>

          {/* GitHub links */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">
                GitHub Issue URL
              </label>
              <input
                type="url"
                value={githubIssueUrl}
                onChange={(e) => setGithubIssueUrl(e.target.value)}
                className="w-full px-3 py-2 bg-surface-700 border border-surface-500 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-accent"
                placeholder="https://github.com/..."
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">
                GitHub PR URL
              </label>
              <input
                type="url"
                value={githubPrUrl}
                onChange={(e) => setGithubPrUrl(e.target.value)}
                className="w-full px-3 py-2 bg-surface-700 border border-surface-500 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-accent"
                placeholder="https://github.com/..."
              />
            </div>
          </div>

          {/* Attachments */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-gray-400">
                Attachments ({attachments.length})
              </label>
              <button
                onClick={() => setShowAddAttachment(!showAddAttachment)}
                className="text-xs text-accent hover:text-accent-hover transition-colors"
              >
                {showAddAttachment ? "Cancel" : "+ Add"}
              </button>
            </div>

            {attachments.length > 0 && (
              <div className="space-y-1 mb-2">
                {attachments.map((att) => (
                  <div
                    key={att.id}
                    className="flex items-center justify-between px-3 py-1.5 bg-surface-700 rounded-lg text-sm"
                  >
                    <span className="text-gray-300 truncate">
                      {att.filename}
                    </span>
                    <button
                      onClick={() => handleDeleteAttachment(att.id)}
                      className="text-gray-500 hover:text-red-400 transition-colors ml-2 shrink-0"
                    >
                      <svg
                        className="w-3.5 h-3.5"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M6 18L18 6M6 6l12 12"
                        />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}

            {showAddAttachment && (
              <div className="space-y-2 p-3 bg-surface-700 rounded-lg">
                <input
                  type="text"
                  value={newAttachmentName}
                  onChange={(e) => setNewAttachmentName(e.target.value)}
                  className="w-full px-2 py-1.5 bg-surface-600 border border-surface-500 rounded text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-accent"
                  placeholder="Filename"
                />
                <textarea
                  value={newAttachmentContent}
                  onChange={(e) => setNewAttachmentContent(e.target.value)}
                  rows={2}
                  className="w-full px-2 py-1.5 bg-surface-600 border border-surface-500 rounded text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-accent resize-y"
                  placeholder="Content"
                />
                <button
                  onClick={handleAddAttachment}
                  className="px-3 py-1 bg-accent hover:bg-accent-hover text-white text-xs font-medium rounded transition-colors"
                >
                  Add
                </button>
              </div>
            )}
          </div>

          {/* Timestamps */}
          <div className="flex gap-4 text-xs text-gray-500 pt-2 border-t border-surface-600">
            <span>
              Created:{" "}
              {new Date(card.created_at).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
            <span>
              Updated:{" "}
              {new Date(card.updated_at).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between pt-2">
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="px-3 py-1.5 text-sm text-red-400 hover:text-red-300 hover:bg-red-400/10 rounded-lg transition-colors"
            >
              Delete card
            </button>
            <div className="flex items-center gap-2">
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-1.5 bg-surface-600 hover:bg-surface-500 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save"}
              </button>
              <button
                onClick={async () => { await handleSave(); onClose(); }}
                disabled={saving}
                className="px-4 py-1.5 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save + Close"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {showDeleteConfirm && (
        <ConfirmModal title="Delete Card" message="This card will be permanently deleted." onConfirm={handleDelete} onCancel={() => setShowDeleteConfirm(false)} />
      )}
    </div>
  );
}
