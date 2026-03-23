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

export default function TodayPage() {
  const router = useRouter();
  const { isMobile } = useSidebar();
  const [cards, setCards] = useState<ViewCard[]>([]);

  const loadCards = useCallback(async () => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const res = await fetch(`/api/cards/views?view=today&tz=${encodeURIComponent(tz)}`);
    if (res.ok) {
      setCards(await res.json());
    }
  }, []);

  useEffect(() => {
    loadCards();
  }, [loadCards]);

  return (
    <ListView
      cards={cards}
      title="Today"
      icon="📅"
      onRefresh={loadCards}
      onBack={isMobile ? () => router.push("/") : undefined}
    />
  );
}
