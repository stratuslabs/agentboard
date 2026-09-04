"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import ConfirmModal from "@/components/ConfirmModal";
import { agentSetupPrompt } from "@/lib/agent-prompt";

interface ColumnDef {
  name: string;
  color: string;
}

interface Member {
  id: number;
  name: string;
  type: string;
  color: string;
  avatar_url: string | null;
  created_at: string;
}

const PRESET_COLORS = ['#EF4444','#F97316','#EAB308','#22C55E','#06B6D4','#3B82F6','#8B5CF6','#EC4899','#6B7280'];

export default function SettingsPage() {
  const router = useRouter();
  const [boards, setBoards] = useState<string[]>([]);
  const [columns, setColumns] = useState<ColumnDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingBoards, setSavingBoards] = useState(false);
  const [savingColumns, setSavingColumns] = useState(false);
  const [boardsSaved, setBoardsSaved] = useState(false);
  const [columnsSaved, setColumnsSaved] = useState(false);

  // Team state
  const [members, setMembers] = useState<Member[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [showAddMember, setShowAddMember] = useState(false);
  const [newMemberName, setNewMemberName] = useState("");
  const [newMemberType, setNewMemberType] = useState<"human" | "agent">("human");
  const [newMemberColor, setNewMemberColor] = useState(PRESET_COLORS[5]);
  const [editingMemberId, setEditingMemberId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("");
  const [deletingMember, setDeletingMember] = useState<Member | null>(null);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => {
        setBoards(data.default_boards || ["Development", "Marketing", "Sales", "Support"]);
        setColumns(
          data.default_columns || [
            { name: "Backlog", color: "#6B7280" },
            { name: "Todo", color: "#3B82F6" },
            { name: "In Progress", color: "#F59E0B" },
            { name: "In Review", color: "#8B5CF6" },
            { name: "Done", color: "#10B981" },
          ]
        );
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    loadMembers();
  }, []);

  async function loadMembers() {
    setLoadingMembers(true);
    const res = await fetch("/api/members");
    if (res.ok) {
      setMembers(await res.json());
    }
    setLoadingMembers(false);
  }

  async function saveBoards() {
    setSavingBoards(true);
    setBoardsSaved(false);
    await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "default_boards", value: boards.filter((b) => b.trim()) }),
    });
    setSavingBoards(false);
    setBoardsSaved(true);
    setTimeout(() => setBoardsSaved(false), 2000);
  }

  async function saveColumns() {
    setSavingColumns(true);
    setColumnsSaved(false);
    await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "default_columns", value: columns.filter((c) => c.name.trim()) }),
    });
    setSavingColumns(false);
    setColumnsSaved(true);
    setTimeout(() => setColumnsSaved(false), 2000);
  }

  async function handleAddMember() {
    if (!newMemberName.trim()) return;
    const res = await fetch("/api/members", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newMemberName.trim(), type: newMemberType, color: newMemberColor }),
    });
    if (res.ok) {
      setNewMemberName("");
      setNewMemberType("human");
      setNewMemberColor(PRESET_COLORS[5]);
      setShowAddMember(false);
      loadMembers();
    }
  }

  async function handleSaveEdit(memberId: number) {
    if (!editName.trim()) return;
    await fetch(`/api/members/${memberId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editName.trim(), color: editColor }),
    });
    setEditingMemberId(null);
    loadMembers();
  }

  async function handleDeleteMember() {
    if (!deletingMember) return;
    await fetch(`/api/members/${deletingMember.id}`, { method: "DELETE" });
    setDeletingMember(null);
    loadMembers();
  }

  function moveBoardUp(i: number) {
    if (i === 0) return;
    const next = [...boards];
    [next[i - 1], next[i]] = [next[i], next[i - 1]];
    setBoards(next);
  }

  function moveBoardDown(i: number) {
    if (i === boards.length - 1) return;
    const next = [...boards];
    [next[i], next[i + 1]] = [next[i + 1], next[i]];
    setBoards(next);
  }

  function moveColumnUp(i: number) {
    if (i === 0) return;
    const next = [...columns];
    [next[i - 1], next[i]] = [next[i], next[i - 1]];
    setColumns(next);
  }

  function moveColumnDown(i: number) {
    if (i === columns.length - 1) return;
    const next = [...columns];
    [next[i], next[i + 1]] = [next[i + 1], next[i]];
    setColumns(next);
  }

  const humanMembers = members.filter((m) => m.type === "human");
  const agentMembers = members.filter((m) => m.type === "agent");

  if (loading) {
    return (
      <div className="min-h-screen bg-surface-900 flex items-center justify-center">
        <div className="text-gray-400 text-sm">Loading settings...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface-900">
      <div className="max-w-2xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <button
            onClick={() => router.push("/")}
            className="w-8 h-8 rounded-lg hover:bg-surface-700 flex items-center justify-center text-gray-400 hover:text-white transition-colors"
            title="Back"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="text-xl font-semibold text-white">Settings</h1>
        </div>

        {/* Team Section */}
        <section className="mb-10">
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-4">Team</h2>
          <p className="text-xs text-gray-500 mb-4">
            Manage team members and agents. Members can be assigned to cards across all products.
          </p>

          <div className="flex items-center justify-between mb-3">
            <button
              onClick={() => setShowAddMember(!showAddMember)}
              className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Add Member
            </button>
          </div>

          {/* Add member form */}
          {showAddMember && (
            <div className="bg-surface-800 border border-surface-600 rounded-xl p-4 mb-3 space-y-3">
              <div className="flex items-center gap-3">
                <input
                  type="text"
                  value={newMemberName}
                  onChange={(e) => setNewMemberName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleAddMember(); if (e.key === "Escape") setShowAddMember(false); }}
                  className="flex-1 px-3 py-2 bg-surface-700 border border-surface-500 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-accent"
                  placeholder="Name"
                  autoFocus
                />
                <select
                  value={newMemberType}
                  onChange={(e) => setNewMemberType(e.target.value as "human" | "agent")}
                  className="px-3 py-2 bg-surface-700 border border-surface-500 rounded-lg text-sm text-white focus:outline-none focus:ring-1 focus:ring-accent"
                >
                  <option value="human">Human</option>
                  <option value="agent">Agent</option>
                </select>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400">Color:</span>
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setNewMemberColor(c)}
                    className={`w-5 h-5 rounded-full border-2 transition-colors ${newMemberColor === c ? "border-white" : "border-transparent"}`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleAddMember}
                  className="px-3 py-1.5 bg-accent hover:bg-accent-hover text-white text-xs font-medium rounded-lg transition-colors"
                >
                  Add
                </button>
                <button
                  onClick={() => { setShowAddMember(false); setNewMemberName(""); }}
                  className="px-3 py-1.5 text-xs text-gray-400 hover:text-white transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {loadingMembers ? (
            <div className="text-gray-500 text-xs py-4">Loading members...</div>
          ) : members.length === 0 ? (
            <div className="bg-surface-800 border border-surface-600 rounded-xl px-4 py-6 text-center text-gray-500 text-sm">
              No members yet. Add your first team member above.
            </div>
          ) : (
            <div className="bg-surface-800 border border-surface-600 rounded-xl overflow-hidden">
              {/* Humans */}
              {humanMembers.length > 0 && (
                <>
                  <div className="px-4 py-1.5 bg-surface-700/50 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                    People
                  </div>
                  {humanMembers.map((member) => (
                    <MemberRow
                      key={member.id}
                      member={member}
                      isEditing={editingMemberId === member.id}
                      editName={editName}
                      editColor={editColor}
                      onStartEdit={() => { setEditingMemberId(member.id); setEditName(member.name); setEditColor(member.color); }}
                      onEditName={setEditName}
                      onEditColor={setEditColor}
                      onSaveEdit={() => handleSaveEdit(member.id)}
                      onCancelEdit={() => setEditingMemberId(null)}
                      onDelete={() => setDeletingMember(member)}
                    />
                  ))}
                </>
              )}
              {/* Agents */}
              {agentMembers.length > 0 && (
                <>
                  <div className="px-4 py-1.5 bg-surface-700/50 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                    Agents
                  </div>
                  {agentMembers.map((member) => (
                    <MemberRow
                      key={member.id}
                      member={member}
                      isEditing={editingMemberId === member.id}
                      editName={editName}
                      editColor={editColor}
                      onStartEdit={() => { setEditingMemberId(member.id); setEditName(member.name); setEditColor(member.color); }}
                      onEditName={setEditName}
                      onEditColor={setEditColor}
                      onSaveEdit={() => handleSaveEdit(member.id)}
                      onCancelEdit={() => setEditingMemberId(null)}
                      onDelete={() => setDeletingMember(member)}
                    />
                  ))}
                </>
              )}
            </div>
          )}

          {/* Coming Soon: Teams */}
          <div className="mt-6 bg-surface-700 border border-surface-600 rounded-xl px-4 py-4">
            <div className="flex items-center gap-2 mb-1">
              <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              <span className="text-sm font-medium text-gray-400">Teams — Coming Soon</span>
            </div>
            <p className="text-xs text-gray-500">
              Invite team members, manage permissions, and collaborate across your organization.
            </p>
          </div>
        </section>

        {/* Connect an Agent */}
        <section className="mb-10">
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-4">Connect an Agent</h2>
          <p className="text-xs text-gray-500 mb-4">
            Copy this prompt and paste it to any AI agent to connect it to AgentBoard. It will auto-register as a member and can manage tasks via CLI.
          </p>
          <AgentOnboardingPrompt members={members} />
        </section>

        {/* Default Boards */}
        <section className="mb-10">
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-4">Default Boards</h2>
          <p className="text-xs text-gray-500 mb-4">
            Configure which boards are created by default when a new product is added.
            Changes only affect new products.
          </p>
          <div className="bg-surface-800 border border-surface-600 rounded-xl overflow-hidden">
            {boards.map((board, i) => (
              <div
                key={i}
                className="flex items-center gap-2 px-4 py-2.5 border-b border-surface-700 last:border-b-0 group"
              >
                {/* Move buttons */}
                <div className="flex flex-col gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => moveBoardUp(i)}
                    disabled={i === 0}
                    className="w-4 h-4 flex items-center justify-center text-gray-500 hover:text-gray-300 disabled:opacity-30 disabled:cursor-default"
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                    </svg>
                  </button>
                  <button
                    onClick={() => moveBoardDown(i)}
                    disabled={i === boards.length - 1}
                    className="w-4 h-4 flex items-center justify-center text-gray-500 hover:text-gray-300 disabled:opacity-30 disabled:cursor-default"
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                </div>
                {/* Name input */}
                <input
                  type="text"
                  value={board}
                  onChange={(e) => {
                    const next = [...boards];
                    next[i] = e.target.value;
                    setBoards(next);
                  }}
                  className="flex-1 bg-transparent text-sm text-white border-none outline-none focus:ring-0 placeholder-gray-600"
                  placeholder="Board name"
                />
                {/* Delete */}
                <button
                  onClick={() => setBoards(boards.filter((_, j) => j !== i))}
                  className="w-6 h-6 flex items-center justify-center rounded text-gray-600 hover:text-red-400 hover:bg-red-400/10 transition-colors opacity-0 group-hover:opacity-100"
                  title="Remove"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between mt-3">
            <button
              onClick={() => setBoards([...boards, ""])}
              className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Add board
            </button>
            <button
              onClick={saveBoards}
              disabled={savingBoards}
              className="px-4 py-1.5 text-sm font-medium rounded-lg bg-accent hover:bg-accent-hover text-white transition-colors disabled:opacity-50"
            >
              {savingBoards ? "Saving..." : boardsSaved ? "Saved!" : "Save"}
            </button>
          </div>
        </section>

        {/* Default Columns */}
        <section className="mb-10">
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-4">Default Columns</h2>
          <p className="text-xs text-gray-500 mb-4">
            Configure the default columns created in each new board. Each column has a name and color.
          </p>
          <div className="bg-surface-800 border border-surface-600 rounded-xl overflow-hidden">
            {columns.map((col, i) => (
              <div
                key={i}
                className="flex items-center gap-2 px-4 py-2.5 border-b border-surface-700 last:border-b-0 group"
              >
                {/* Move buttons */}
                <div className="flex flex-col gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => moveColumnUp(i)}
                    disabled={i === 0}
                    className="w-4 h-4 flex items-center justify-center text-gray-500 hover:text-gray-300 disabled:opacity-30 disabled:cursor-default"
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                    </svg>
                  </button>
                  <button
                    onClick={() => moveColumnDown(i)}
                    disabled={i === columns.length - 1}
                    className="w-4 h-4 flex items-center justify-center text-gray-500 hover:text-gray-300 disabled:opacity-30 disabled:cursor-default"
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                </div>
                {/* Color picker */}
                <div className="relative shrink-0">
                  <div
                    className="w-5 h-5 rounded-full border border-surface-500 cursor-pointer"
                    style={{ backgroundColor: col.color }}
                  />
                  <input
                    type="color"
                    value={col.color}
                    onChange={(e) => {
                      const next = [...columns];
                      next[i] = { ...next[i], color: e.target.value };
                      setColumns(next);
                    }}
                    className="absolute inset-0 w-5 h-5 opacity-0 cursor-pointer"
                  />
                </div>
                {/* Name input */}
                <input
                  type="text"
                  value={col.name}
                  onChange={(e) => {
                    const next = [...columns];
                    next[i] = { ...next[i], name: e.target.value };
                    setColumns(next);
                  }}
                  className="flex-1 bg-transparent text-sm text-white border-none outline-none focus:ring-0 placeholder-gray-600"
                  placeholder="Column name"
                />
                {/* Delete */}
                <button
                  onClick={() => setColumns(columns.filter((_, j) => j !== i))}
                  className="w-6 h-6 flex items-center justify-center rounded text-gray-600 hover:text-red-400 hover:bg-red-400/10 transition-colors opacity-0 group-hover:opacity-100"
                  title="Remove"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between mt-3">
            <button
              onClick={() => setColumns([...columns, { name: "", color: "#6B7280" }])}
              className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Add column
            </button>
            <button
              onClick={saveColumns}
              disabled={savingColumns}
              className="px-4 py-1.5 text-sm font-medium rounded-lg bg-accent hover:bg-accent-hover text-white transition-colors disabled:opacity-50"
            >
              {savingColumns ? "Saving..." : columnsSaved ? "Saved!" : "Save"}
            </button>
          </div>
          <p className="text-xs text-gray-600 mt-3">
            These columns will be created in every new board for new products.
          </p>
        </section>
      </div>

      {deletingMember && (
        <ConfirmModal
          title="Delete Member"
          message={`Remove "${deletingMember.name}" from the team? Cards assigned to this member will become unassigned.`}
          onConfirm={handleDeleteMember}
          onCancel={() => setDeletingMember(null)}
        />
      )}
    </div>
  );
}

function AgentOnboardingPrompt({ members }: { members: Member[] }) {
  const [copied, setCopied] = useState(false);

  const boardUrl = typeof window !== "undefined" ? window.location.origin : "https://your-agentboard-url.com";

  const prompt = agentSetupPrompt(boardUrl);

  function handleCopy() {
    navigator.clipboard.writeText(prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="space-y-3">
      <div className="bg-surface-700/50 border border-surface-600 rounded-lg px-4 py-3">
        <p className="text-xs text-gray-300 mb-1">
          <strong>How it works:</strong> Copy the prompt below and paste it to your agent. The agent will:
        </p>
        <ol className="text-xs text-gray-400 list-decimal list-inside space-y-0.5">
          <li>Register itself as a team member</li>
          <li>Set up the CLI</li>
          <li>Check for assigned tasks</li>
          <li>Start working</li>
        </ol>
      </div>

      <div className="relative">
        <pre className="bg-surface-900 border border-surface-600 rounded-xl p-4 text-xs text-gray-300 overflow-x-auto max-h-72 overflow-y-auto whitespace-pre-wrap font-mono">
          {prompt}
        </pre>
        <button
          onClick={handleCopy}
          className={`absolute top-2 right-2 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
            copied
              ? "bg-green-500/20 text-green-400 border border-green-500/30"
              : "bg-surface-700 text-gray-300 border border-surface-500 hover:bg-surface-600 hover:text-white"
          }`}
        >
          {copied ? "Copied!" : "Copy prompt"}
        </button>
      </div>

      {members.filter((m) => m.type === "agent").length > 0 && (
        <p className="text-xs text-gray-500">
          Connected agents: {members.filter((m) => m.type === "agent").map((m) => m.name).join(", ")}
        </p>
      )}
    </div>
  );
}

function MemberRow({
  member,
  isEditing,
  editName,
  editColor,
  onStartEdit,
  onEditName,
  onEditColor,
  onSaveEdit,
  onCancelEdit,
  onDelete,
}: {
  member: Member;
  isEditing: boolean;
  editName: string;
  editColor: string;
  onStartEdit: () => void;
  onEditName: (v: string) => void;
  onEditColor: (v: string) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onDelete: () => void;
}) {
  if (isEditing) {
    return (
      <div className="px-4 py-2.5 border-b border-surface-700 last:border-b-0 space-y-2">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={editName}
            onChange={(e) => onEditName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") onSaveEdit(); if (e.key === "Escape") onCancelEdit(); }}
            className="flex-1 px-2 py-1.5 bg-surface-700 border border-surface-500 rounded text-sm text-white focus:outline-none focus:ring-1 focus:ring-accent"
            autoFocus
          />
          <button onClick={onSaveEdit} className="px-2 py-1 bg-accent hover:bg-accent-hover text-white text-xs rounded transition-colors">Save</button>
          <button onClick={onCancelEdit} className="px-2 py-1 text-xs text-gray-400 hover:text-white transition-colors">Cancel</button>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-gray-400 mr-1">Color:</span>
          {PRESET_COLORS.map((c) => (
            <button
              key={c}
              onClick={() => onEditColor(c)}
              className={`w-4 h-4 rounded-full border-2 transition-colors ${editColor === c ? "border-white" : "border-transparent"}`}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 border-b border-surface-700 last:border-b-0 group">
      <div
        className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-semibold text-white shrink-0"
        style={{ backgroundColor: member.color }}
      >
        {member.name.charAt(0).toUpperCase()}
      </div>
      <span className="text-sm text-white flex-1">{member.name}</span>
      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${member.type === "agent" ? "bg-purple-500/20 text-purple-300" : "bg-surface-600 text-gray-400"}`}>
        {member.type === "agent" ? "Agent \u{1F916}" : "Human"}
      </span>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={onStartEdit}
          className="w-6 h-6 flex items-center justify-center rounded text-gray-500 hover:text-white hover:bg-surface-600 transition-colors"
          title="Edit"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
          </svg>
        </button>
        <button
          onClick={onDelete}
          className="w-6 h-6 flex items-center justify-center rounded text-gray-500 hover:text-red-400 hover:bg-red-400/10 transition-colors"
          title="Delete"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
