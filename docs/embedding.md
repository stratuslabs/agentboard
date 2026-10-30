# Using the AgentBoard core in another Next app

The app is also a package, `@stratuslabs/agentboard-core`, that another Next app can mount: its pages, API routes and components, with that app deciding which team a request acts for. This is how a hosted edition is built on the same code instead of a copy. It is early: not published to npm, and the import paths below are the source layout, not a stable API yet.

**Install** a commit of this repository (npm installs it with `npm pack`, so you get `src/` as TypeScript):

```bash
npm install "github:stratuslabs/agentboard#<commit>" next@^16.4.3 react@^19.3.1 react-dom@^19.3.1 tailwindcss@^4.3.3 @tailwindcss/postcss@^4.3.3
```

`next`, `react`, `react-dom`, `tailwindcss` and `@tailwindcss/postcss` are peer dependencies: the core ships source, and your app compiles it.

**Build settings.** In `next.config.ts`, `transpilePackages: ["@stratuslabs/agentboard-core"]`. Add a `postcss.config.mjs` with the `@tailwindcss/postcss` plugin. Some of the core's modules are JavaScript with JSDoc types, so your `tsconfig.json` needs `"allowJs": true` and `"maxNodeModuleJsDepth": 10` for `next build`'s type-check to see them.

**Mount what you need** by re-exporting it from your own `app/` directory. Each module is importable at its path under `src/`, without the extension:

```ts
// app/layout.tsx: the core's root layout, with its stylesheet and fonts
export { default, metadata } from "@stratuslabs/agentboard-core/app/layout";

// app/(board)/[orgSlug]/[productSlug]/page.tsx
export { default } from "@stratuslabs/agentboard-core/app/(board)/[orgSlug]/[productSlug]/page";

// app/api/cards/route.ts
export { GET, POST } from "@stratuslabs/agentboard-core/app/api/cards/route";
```

Route segment options (`runtime`, `dynamic`, `maxDuration`) can't be re-exported; Next reads them from your file, so copy them. `app/api/stream/route.ts` is the one route that has them. Files in `public/` (the logo and icons) aren't part of the package either.

**Tell the core who is asking** with `configure()`, once, from `instrumentation.ts`:

```ts
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { configure } = await import("@stratuslabs/agentboard-core/configure");
  const { TenantError } = await import("@stratuslabs/agentboard-core/lib/tenant");
  configure({
    tenant: {
      // Route handlers: from the request's session or API key.
      fromRequest: async (request) => {
        const team = await yourAuth(request);
        if (!team) throw new TenantError(401, "Unauthorized");
        return { teamId: team.id, userId: team.userId ?? null };
      },
      // Server components, which have no Request: read next/headers or cookies.
      fromPage: async () => { /* same, from headers() */ },
    },
  });
}
```

A resolver may also return `memberId`, the agent member the caller's credential belongs to (an API key issued to one agent). A new card with no assignee is filed under it, and `X-Agent-Name` is ignored for that caller, since the credential already says who it is, on updates too. A named `assignee` or `assignee_id` still wins. Updates never reassign a card to the credential's agent.

Every query the core runs is scoped to the `teamId` this returns, and it is the only place a team comes from. Throw a `TenantError` to refuse a request with that status (401, 402 for a lapsed subscription, 403); the route never runs. Teams are rows in the core's `teams` table, which your app creates (`ensureTeamDefaults` from `lib/tenancy` gives a new one the default boards and columns).

`configure({ members: { beforeTypeChange } })` runs before a member changes between agent and human, with `{ teamId, memberId, from, to }`. Throw a `TenantError` to refuse it (for example, 409 while the agent still holds API keys).

`configure({ reservedOrgSlugs: ["signup", "billing"] })` names the top-level pages your app adds. An organization lives at `/<org-slug>`, so an org named "Billing" would be hidden behind your billing page; with this it gets `billing-org` instead, and a request for one of these slugs outright is refused. The core's own paths (`api`, `c`, `settings`, ...) are always reserved.

`configure({ orgPages: true })` says your app mounts the org page, `app/(board)/[orgSlug]/page.tsx` (re-export `@stratuslabs/agentboard-core/app/(board)/[orgSlug]/page`). The org name in a board's breadcrumb then links to `/<org-slug>`, which lists the org's products. Leave it out and the name stays plain text, so an app that doesn't mount the page never links to a 404. Self-hosted AgentBoard has org pages without it.

Without `configure()`, every request acts for the single self-hosted team, which is what self-hosted AgentBoard is. For a multi-team app that means a missed `configure()` fails open, so test that an unauthenticated request is refused. The self-hosted password check lives in `src/middleware.ts` and is not part of `configure()`; a consuming app authenticates in its resolver.

**Add your own UI** by rendering the core's components from your files instead of re-exporting them. The board layout takes sidebar slots, rendered above Settings, and the settings screen takes a scope label and a list of sections, which you build from the core's defaults by `id` (`members`, `connect`, `agent-board`, `default-boards`, `default-columns`):

```tsx
// app/(board)/layout.tsx
"use client";
import BoardLayout from "@stratuslabs/agentboard-core/components/BoardLayout";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <BoardLayout sidebarFooter={<TeamSwitcher />} sidebarRail={<TeamSwitcher collapsed />}>
      {children}
    </BoardLayout>
  );
}

// app/settings/page.tsx
"use client";
import SettingsShell from "@stratuslabs/agentboard-core/components/settings/SettingsShell";
import { defaultSettingsSections } from "@stratuslabs/agentboard-core/components/settings/sections";

const sections = [
  ...defaultSettingsSections().filter((s) => s.id !== "agent-board"),
  { id: "billing", group: "Team", label: "Billing", icon: <CreditCard />, description: "Your plan.", content: <Billing /> },
];

export default function SettingsPage() {
  return <SettingsShell scope={<ActiveTeamName />} sections={sections} />;
}
```

If your app sets agents up differently (per-agent API keys instead of a shared token, say), give both the same prompt function, `(boardUrl: string) => string`, and the sidebar's get-started card and the settings connect section show yours instead of the core's: `<BoardLayout agentSetupPrompt={myPrompt}>` and `defaultSettingsSections({ agentSetupPrompt: myPrompt })`. It's a function, so the files that pass it must be client components, as above.

[test/consumer](../test/consumer) is a working example, and CI builds and drives it (`scripts/verify-consumer.mjs`) against the lowest and newest supported Next 16.
