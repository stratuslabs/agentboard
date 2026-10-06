"use client";

import { useState } from "react";
import { UserRound } from "lucide-react";
import { usePreferences } from "@/contexts/PreferencesContext";
import { Avatar, Button, ColorSwatches, Dialog, Field, Input, PRESET_COLORS } from "./ui";


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
    <Dialog onClose={() => {}} dismissable={false} heavy z={200} className="w-[384px] max-w-full rounded-2xl">
      <form onSubmit={handleSubmit} className="flex flex-col gap-5 p-7">
        {/* Header */}
        <div className="flex flex-col items-center gap-2 text-center">
          <Avatar name={name.trim() || "?"} color={color} size={48} className="mb-1" />
          <h2 className="text-lg font-semibold tracking-[-0.3px] text-text-1">Set up your profile</h2>
          <p className="text-[13px] text-text-2">
            Tell us who you are so your team knows it&apos;s you.
          </p>
        </div>

        <Field label="Name" htmlFor="profile-name">
          <Input
            id="profile-name"
            inputSize="lg"
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (error) setError("");
            }}
            placeholder="Your name"
            autoFocus
            disabled={submitting}
          />
        </Field>

        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-text-2">Color</span>
          <ColorSwatches value={color} onChange={setColor} disabled={submitting} className="justify-between" />
        </div>

        <div className="flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-2.5 text-[12.5px]">
          <UserRound className="h-3.5 w-3.5 text-text-2" />
          <span className="text-text-3">Joining as</span>
          <span className="font-medium text-text-1">Human</span>
        </div>

        {error && (
          <div className="rounded-lg border border-danger/25 bg-danger/10 px-3 py-2 text-xs text-danger">
            {error}
          </div>
        )}

        <Button type="submit" variant="primary" size="lg" disabled={submitting} className="w-full">
          {submitting ? "Setting up…" : "Continue"}
        </Button>
      </form>
    </Dialog>
  );
}
