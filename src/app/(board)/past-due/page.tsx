"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, CircleCheck } from "lucide-react";
import ListView, { type ViewCard } from "@/components/ListView";
import { useSidebar } from "@/contexts/SidebarContext";


export default function PastDuePage() {
  const router = useRouter();
  const { isMobile } = useSidebar();
  const [cards, setCards] = useState<ViewCard[]>([]);
  const [currentMemberId, setCurrentMemberId] = useState<number | null>(null);

  // Find the first human member (same approach as Assigned page)
  useEffect(() => {
    fetch("/api/members")
      .then((r) => r.json())
      .then((members: { id: number; type: string }[]) => {
        const human = members.find((m) => m.type === "human");
        // Cleared rather than left alone when there is no human: this list
        // belongs to a member, and holding the last one keeps rows on screen
        // for somebody who is gone.
        setCurrentMemberId(human ? human.id : null);
      })
      .catch(() => {});
  }, []);

  const loadCards = useCallback(async () => {
    if (!currentMemberId) {
      setCards([]);
      return;
    }
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const res = await fetch(`/api/cards/views?view=past-due&member_id=${currentMemberId}&tz=${encodeURIComponent(tz)}`);
    if (res.ok) {
      setCards(await res.json());
    }
  }, [currentMemberId]);

  useEffect(() => {
    if (currentMemberId !== null) {
      loadCards();
    }
  }, [currentMemberId, loadCards]);

  return (
    <ListView
      cards={cards}
      title="Past Due"
      icon={<CircleAlert />}
      emptyMessage="Nothing assigned to you is overdue."
      emptyIcon={<CircleCheck />}
      tone="danger"
      onRefresh={loadCards}
      onBack={isMobile ? () => router.push("/") : undefined}
    />
  );
}
