"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CircleUserRound } from "lucide-react";
import ListView from "../../../components/ListView";
import { useSidebar } from "../../../contexts/SidebarContext";
import { memberViewFetcher, useViewCards } from "../../../lib/view-cards";


export default function AssignedPage() {
  const router = useRouter();
  const { isMobile } = useSidebar();
  // "Assigned to me" is the board's first human member. The route requires a
  // member and answers 400 without one, so with no human the list is empty
  // rather than an "everyone" query.
  const [fetchCards] = useState(() =>
    memberViewFetcher((memberId) => `/api/cards/views?view=assigned&member_id=${memberId}`),
  );
  const { state, cards, reload } = useViewCards(fetchCards);

  return (
    <ListView
      cards={cards}
      status={state.status}
      title="Assigned to me"
      listId="assigned"
      icon={<CircleUserRound />}
      emptyMessage="No cards are assigned to you."
      onRefresh={reload}
      onBack={isMobile ? () => router.push("/") : undefined}
    />
  );
}
