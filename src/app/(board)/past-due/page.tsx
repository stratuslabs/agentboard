"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import ListView from "@/components/ListView";
import { useSidebar } from "@/contexts/SidebarContext";

interface ViewCard {
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
  org_name: string;
  product_name: string;
  product_emoji: string;
  board_name: string;
  column_name: string;
  column_color: string;
}

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
        if (human) setCurrentMemberId(human.id);
      })
      .catch(() => {});
  }, []);

  const loadCards = useCallback(async () => {
    if (!currentMemberId) return;
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
      icon="🔴"
      onRefresh={loadCards}
      onBack={isMobile ? () => router.push("/") : undefined}
    />
  );
}
