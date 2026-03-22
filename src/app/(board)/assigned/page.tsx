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
        if (human) setCurrentMemberId(human.id);
      })
      .catch(() => {});
  }, []);

  const loadCards = useCallback(async () => {
    let url = "/api/cards/views?view=assigned";
    if (currentMemberId) {
      url += `&member_id=${currentMemberId}`;
    }
    const res = await fetch(url);
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
      title="Assigned to me"
      icon="👤"
      onRefresh={loadCards}
      onBack={isMobile ? () => router.push("/") : undefined}
    />
  );
}
