"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { CalendarCheck, CalendarDays } from "lucide-react";
import ListView, { type ViewCard } from "@/components/ListView";
import { useSidebar } from "@/contexts/SidebarContext";


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
      icon={<CalendarDays />}
      emptyMessage="No cards are due today."
      emptyIcon={<CalendarCheck />}
      onRefresh={loadCards}
      onBack={isMobile ? () => router.push("/") : undefined}
    />
  );
}
