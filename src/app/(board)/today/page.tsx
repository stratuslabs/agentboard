"use client";

import { useRouter } from "next/navigation";
import { CalendarCheck, CalendarDays, Eye, EyeOff } from "lucide-react";
import ListView, { type ViewCard } from "../../../components/ListView";
import { Button } from "../../../components/ui";
import { useSidebar } from "../../../contexts/SidebarContext";
import { usePreferences } from "../../../contexts/PreferencesContext";
import { withoutDone } from "../../../lib/done-cards";
import { fetchJsonList, useViewCards } from "../../../lib/view-cards";

function fetchToday() {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return fetchJsonList<ViewCard>(`/api/cards/views?view=today&tz=${encodeURIComponent(tz)}`);
}


export default function TodayPage() {
  const router = useRouter();
  const { isMobile } = useSidebar();
  const { prefs, setHideDoneToday } = usePreferences();
  const { state, cards, reload } = useViewCards(fetchToday);

  const hide = prefs.hideDoneToday;
  const { cards: shown, hidden } = withoutDone(cards, hide);
  const allDone = hide && cards.length > 0 && shown.length === 0;

  return (
    <ListView
      cards={shown}
      status={state.status}
      title="Today"
      listId="today"
      icon={<CalendarDays />}
      note={hidden > 0 ? `${hidden} done hidden` : undefined}
      actions={cards.length > 0 && (
        <Button
          variant="ghost"
          size="sm"
          aria-pressed={hide}
          onClick={() => setHideDoneToday(!hide)}
        >
          {hide ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
          {hide ? "Show done" : "Hide done"}
        </Button>
      )}
      emptyTitle={allDone ? "Nothing left for today" : undefined}
      emptyMessage={allDone ? "Everything due today is done." : "No cards are due today."}
      emptyIcon={<CalendarCheck />}
      onRefresh={reload}
      onBack={isMobile ? () => router.push("/") : undefined}
    />
  );
}
