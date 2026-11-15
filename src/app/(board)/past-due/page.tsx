"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, CircleCheck } from "lucide-react";
import ListView from "../../../components/ListView";
import { useSidebar } from "../../../contexts/SidebarContext";
import { memberViewFetcher, useViewCards } from "../../../lib/view-cards";


export default function PastDuePage() {
  const router = useRouter();
  const { isMobile } = useSidebar();
  // Past due for the board's first human member, as on Assigned to me.
  const [fetchCards] = useState(() =>
    memberViewFetcher((memberId) => {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      return `/api/cards/views?view=past-due&member_id=${memberId}&tz=${encodeURIComponent(tz)}`;
    }),
  );
  const { state, cards, reload } = useViewCards(fetchCards);

  return (
    <ListView
      cards={cards}
      status={state.status}
      title="Past Due"
      listId="past-due"
      icon={<CircleAlert />}
      emptyMessage="Nothing assigned to you is overdue."
      emptyIcon={<CircleCheck />}
      tone="danger"
      onRefresh={reload}
      onBack={isMobile ? () => router.push("/") : undefined}
    />
  );
}
