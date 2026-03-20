"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

interface ColumnDef {
  name: string;
  color: string;
}

export default function SettingsPage() {
  const router = useRouter();
  const [boards, setBoards] = useState<string[]>([]);
  const [columns, setColumns] = useState<ColumnDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingBoards, setSavingBoards] = useState(false);
  const [savingColumns, setSavingColumns] = useState(false);
  const [boardsSaved, setBoardsSaved] = useState(false);
  const [columnsSaved, setColumnsSaved] = useState(false);

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
    </div>
  );
}
