"use client";

import { useState } from "react";
import { usePreferences } from "@/contexts/PreferencesContext";

const PRESET_COLORS = [
  "#EF4444",
  "#F97316",
  "#EAB308",
  "#22C55E",
  "#06B6D4",
  "#3B82F6",
  "#8B5CF6",
  "#EC4899",
  "#6B7280",
];

export default function ProfileSetup() {
  const { prefs, isLoaded, setProfileMemberId } = usePreferences();
  const [name, setName] = useState("");
  const [color, setColor] = useState(PRESET_COLORS[5]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // Don't render if prefs not loaded yet or profile already set
  if (!isLoaded || prefs.profileMemberId !== null) {
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Please enter your name");
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      // Step 1: Create the member
      const memberRes = await fetch("/api/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed, type: "human", color }),
      });

      if (!memberRes.ok) {
        const data = await memberRes.json().catch(() => ({}));
        throw new Error(data.error || "Failed to create member");
      }

      const member = await memberRes.json();

      // Step 2: Save profile member ID to preferences
      const prefRes = await fetch("/api/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: "agentboard-profile-member-id",
          value: member.id,
        }),
      });

      if (!prefRes.ok) {
        throw new Error("Failed to save profile preference");
      }

      // Step 3: Update local context
      setProfileMemberId(member.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div
        className="bg-surface-800 border border-surface-600 rounded-2xl shadow-2xl w-96 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="text-center mb-6">
          <div className="w-12 h-12 rounded-xl bg-surface-700 border border-surface-500 flex items-center justify-center mx-auto mb-3">
            <svg
              className="w-6 h-6 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
              />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-white">Set up your profile</h2>
          <p className="text-sm text-gray-400 mt-1">
            Tell us who you are so your team knows it&apos;s you.
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Name */}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">
              Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (error) setError("");
              }}
              className="w-full px-3 py-2.5 bg-surface-700 border border-surface-500 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-accent"
              placeholder="Your name"
              autoFocus
              disabled={submitting}
            />
          </div>

          {/* Color picker */}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-2">
              Pick a color
            </label>
            <div className="flex items-center gap-2">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`w-7 h-7 rounded-full border-2 transition-all ${
                    color === c
                      ? "border-white scale-110"
                      : "border-transparent hover:border-gray-500"
                  }`}
                  style={{ backgroundColor: c }}
                  disabled={submitting}
                />
              ))}
            </div>
          </div>

          {/* Preview */}
          <div className="flex items-center gap-3 bg-surface-700/50 border border-surface-600 rounded-lg px-3 py-2.5">
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold text-white shrink-0"
              style={{ backgroundColor: color }}
            >
              {name.trim() ? name.trim().charAt(0).toUpperCase() : "?"}
            </div>
            <div>
              <div className="text-sm text-white">
                {name.trim() || "Your name"}
              </div>
              <div className="text-[10px] text-gray-500">Human</div>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={submitting}
            className="w-full py-2.5 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? "Setting up..." : "Continue"}
          </button>
        </form>
      </div>
    </div>
  );
}
