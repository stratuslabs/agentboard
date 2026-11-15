"use client";

import { useState, type ComponentProps } from "react";
import { useRouter } from "next/navigation";
import ListView from "./ListView";
import { usePreferences } from "../contexts/PreferencesContext";
import { useSidebar } from "../contexts/SidebarContext";
import { memberViewFetcher, useViewCards } from "../lib/view-cards";

type MemberListViewProps = Omit<ComponentProps<typeof ListView>, "cards" | "status" | "onRefresh" | "onBack"> & {
  /** The cards URL for a member. */
  url: (memberId: number) => string;
};

/**
 * A list of the signed-in person's own cards (Assigned to me, Past Due): the
 * cards assigned to the profile member the server confirms for them. It shows
 * the loader until the server says who that is, an error with Try again if it
 * can't, and the empty state when they have no profile yet, while profile
 * setup opens over it. It used to take the team's first human member, so on a
 * team with two people one of them saw the other's cards (AB-162).
 */
export default function MemberListView({ url, ...list }: MemberListViewProps) {
  const router = useRouter();
  const { isMobile } = useSidebar();
  const { confirmedProfileMemberId: member, serverLoadFailed, reloadPreferences } = usePreferences();
  const onBack = isMobile ? () => router.push("/") : undefined;

  if (member === undefined) {
    return (
      <ListView {...list} cards={[]} status={serverLoadFailed ? "failed" : "loading"} onRefresh={reloadPreferences} onBack={onBack} />
    );
  }
  // A new list for each member, so a change of profile starts again from the
  // loader and never leaves one person's cards on screen as another's.
  return <MemberCards key={member ?? "none"} member={member} url={url} onBack={onBack} {...list} />;
}

function MemberCards({ member, url, onBack, ...list }: MemberListViewProps & { member: number | null; onBack?: () => void }) {
  const [fetchCards] = useState(() => memberViewFetcher(member, url));
  const { state, cards, reload } = useViewCards(fetchCards);
  return <ListView {...list} cards={cards} status={state.status} onRefresh={reload} onBack={onBack} />;
}
