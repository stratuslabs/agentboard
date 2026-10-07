"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { CircleUserRound } from "lucide-react";
import ListView, { type ViewCard } from "@/components/ListView";
import { useSidebar } from "@/contexts/SidebarContext";


export default function AssignedPage() {
  const router = useRouter();
  const { isMobile } = useSidebar();
  const [cards, setCards] = useState<ViewCard[]>([]);
  const [currentMemberId, setCurrentMemberId] = useState<number | null>(null);

  // Fetch first human member for "assigned to me"
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
    // The route requires a member and answers 400 without one, so there was
    // never an "everyone" query here — only a request that failed quietly and
    // left the previous member's cards on screen.
    if (currentMemberId === null) {
      setCards([]);
      return;
    }
    const res = await fetch(
      `/api/cards/views?view=assigned&member_id=${currentMemberId}`
    );
    if (res.ok) {
      setCards(await res.json());
    }
  }, [currentMemberId]);

  useEffect(() => {
    loadCards();
  }, [loadCards]);

  return (
    <ListView
      cards={cards}
      title="Assigned to me"
      icon={<CircleUserRound />}
      emptyMessage="No cards are assigned to you."
      onRefresh={loadCards}
      onBack={isMobile ? () => router.push("/") : undefined}
    />
  );
}
