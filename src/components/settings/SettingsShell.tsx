"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Slash } from "lucide-react";
import { Logo, cx } from "../ui";

export interface SettingsSectionDef {
  id: string;
  /** Left-nav group heading, e.g. "Team". Sections sharing a group sit together. */
  group: string;
  /** Left-nav label; also the section title unless `title` is given. */
  label: string;
  icon: React.ReactNode;
  title?: string;
  description: React.ReactNode;
  content: React.ReactNode;
}

/** Top bar, a scroll-tracking left nav, and two-column sections. */
export default function SettingsShell({ scope, sections }: { scope: React.ReactNode; sections: SettingsSectionDef[] }) {
  const router = useRouter();
  const [active, setActive] = useState(sections[0]?.id);
  const contentRef = useRef<HTMLDivElement>(null);

  // Highlight whichever section's top has most recently scrolled past the top third.
  useEffect(() => {
    const root = contentRef.current;
    if (!root) return;
    function onScroll() {
      const limit = root!.getBoundingClientRect().top + root!.clientHeight / 3;
      let current = sections[0]?.id;
      for (const s of sections) {
        const el = document.getElementById(s.id);
        if (el && el.getBoundingClientRect().top <= limit) current = s.id;
      }
      setActive(current);
    }
    onScroll();
    root.addEventListener("scroll", onScroll, { passive: true });
    return () => root.removeEventListener("scroll", onScroll);
  }, [sections]);

  // Arriving at /settings#team (for example from the team switcher) lands on that section.
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (id) document.getElementById(id)?.scrollIntoView();
  }, []);

  const groups: { name: string; items: SettingsSectionDef[] }[] = [];
  for (const s of sections) {
    const g = groups.find((x) => x.name === s.group);
    if (g) g.items.push(s);
    else groups.push({ name: s.group, items: [s] });
  }

  return (
    <div className="flex h-screen flex-col bg-bg">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-6 max-md:px-4">
        <button
          onClick={() => router.push("/")}
          aria-label="Back to boards"
          title="Back"
          className="flex h-[30px] w-[30px] items-center justify-center rounded-[7px] border border-border-strong text-text-2 transition-colors hover:bg-surface-2 hover:text-text-1"
        >
          <ArrowLeft className="h-[15px] w-[15px]" />
        </button>
        <Logo size={22} />
        <span className="truncate text-[13px] text-text-3">{scope}</span>
        <Slash className="h-3 w-3 shrink-0 text-text-4" />
        <h1 className="text-[13px] font-semibold text-text-1">Settings</h1>
      </header>

      <div className="flex min-h-0 flex-1">
        <nav className="flex w-[264px] shrink-0 flex-col gap-[18px] overflow-y-auto border-r border-border pt-8 pr-4 pb-8 pl-6 max-lg:hidden" aria-label="Settings sections">
          {groups.map((g) => (
            <div key={g.name} className="flex flex-col gap-px">
              <span className="mb-1.5 font-mono text-[10.5px] tracking-[0.8px] text-text-4 uppercase">{g.name}</span>
              {g.items.map((s) => (
                <a
                  key={s.id}
                  href={`#${s.id}`}
                  onClick={() => setActive(s.id)}
                  className={cx(
                    "flex h-[29px] items-center gap-2.5 rounded-md px-2 text-[13px] transition-colors [&>svg]:h-4 [&>svg]:w-4",
                    active === s.id ? "bg-surface-3 font-medium text-text-1" : "text-text-2 hover:bg-surface-2 hover:text-text-1",
                  )}
                >
                  {s.icon}
                  {s.label}
                </a>
              ))}
            </div>
          ))}
        </nav>

        <div ref={contentRef} className="min-w-0 flex-1 overflow-y-auto scroll-smooth">
          <div className="max-w-[1100px] pt-2 pr-[72px] pb-20 pl-16 max-lg:px-8 max-md:px-4">
            {sections.map((s, i) => (
              <section
                key={s.id}
                id={s.id}
                className={cx("flex scroll-mt-2 gap-14 py-10 max-lg:flex-col max-lg:gap-5", i < sections.length - 1 && "border-b border-border")}
              >
                <div className="flex w-[260px] shrink-0 flex-col gap-2 max-lg:w-full">
                  <h2 className="text-[15px] font-semibold tracking-[-0.1px] text-text-1">{s.title ?? s.label}</h2>
                  <div className="text-[13px] leading-[1.55] text-text-3">{s.description}</div>
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-3.5">{s.content}</div>
              </section>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
