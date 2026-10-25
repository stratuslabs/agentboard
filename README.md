# AgentBoard

Lightweight kanban project management for AI agents and humans. Self-hostable, API-first, agent-friendly.

[![Deploy with Vercel](https://vercel.com/button)][deploy]

## Features

- **Kanban boards** — drag-and-drop cards across configurable columns
- **Multi-product** — organize projects under orgs and products
- **Agent-first CLI** — designed for AI agents to create, update, and query tasks
- **REST API** — every action is available via HTTP
- **Auth optional** — run open or protected with a single password
- **Vercel-ready** — deploy in minutes with Vercel Postgres
- **Self-hostable** — runs on any Postgres, locally with Docker or on your own box

## Quick Start

### Local Development

**Prerequisites:** Node.js 20+, Docker

```bash
# 1. Clone
git clone https://github.com/stratuslabs/agentboard.git
cd agentboard

# 2. Install dependencies
npm install

# 3. Start Postgres
docker compose up -d

# 4. Configure environment
cp .env.example .env.local
# Edit .env.local and set:
#   POSTGRES_URL=postgresql://agentboard:agentboard@localhost:5432/agentboard

# 5. Set up the database schema
npm run db:setup

# 6. (Optional) Seed with sample data
npm run db:seed

# 7. Start
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). If `APP_PASSWORD` is not set, no login is required.

### Deploy to Vercel

[![Deploy with Vercel](https://vercel.com/button)][deploy]

The button clones the repo, provisions a Neon Postgres database through the
Vercel Marketplace, and prompts you for `APP_PASSWORD`. **Set one** — without it
the board and its entire API are open to anyone who has the URL.

There is no database setup step: the integration supplies the connection
string — as `POSTGRES_URL` or as `DATABASE_URL`, depending on its version, and
the app reads either — and the schema is created on the first request.

If the flow does not offer to create a database, add one afterwards from the
project's **Storage** tab and redeploy — any Postgres works, and the schema is
still created on the first request.

<details>
<summary>Deploying manually instead</summary>

1. Fork this repo
2. Create a Vercel project and connect it to your fork
3. Add Postgres under Storage → Create Database (the Neon integration sets the
   connection string for you, as `POSTGRES_URL` or `DATABASE_URL`)
4. Set `APP_PASSWORD` (see the table below)
5. Deploy

The schema is created lazily on the first request. To create it up front
instead:

```bash
vercel env pull .env.local
npm run db:setup
```

</details>

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `POSTGRES_URL` | Yes | Postgres connection string. Any Postgres works. `DATABASE_URL` is accepted as a fallback, which is the name some versions of the Vercel/Neon integration set |
| `POSTGRES_POOL_MAX` | No | Max pooled connections per process (default `5`) |
| `DIRECT_POSTGRES_URL` | No | Direct (unpooled) connection string used only for `LISTEN`, which a transaction-mode pooler cannot do. Needed only when `POSTGRES_URL` points at a pooled endpoint. Unset means the event stream polls instead |
| `SSE_MAX_SECONDS` | No | How long an event stream stays open before asking the client to reconnect (default `240`). The reconnect is invisible; this exists because serverless platforms cap streaming responses |
| `SSE_POLL_MS` | No | Poll interval for the event stream when no `LISTEN` connection is available (default `2000`) |
| `APP_PASSWORD` | No | Single password for web UI and API. If unset, app is open (no auth) |
| `TZ` | No | Default timezone for date calculations (e.g. `America/New_York`) |

## CLI

```bash
npm install -g agentboard
```

The CLI declares no dependencies, so that is the whole install. To run it from
a checkout of this repository instead:

```bash
git clone https://github.com/stratuslabs/agentboard.git
npm install -g ./agentboard/cli
```

The CLI source of truth lives in `cli/agentboard.js`. The root `bin/agentboard.js` is just a compatibility wrapper.

Configure it:

```bash
export AGENTBOARD_URL=https://your-instance.vercel.app
export AGENTBOARD_TOKEN=your-password      # if APP_PASSWORD is set
export AGENTBOARD_AGENT_NAME=MyAgent       # auto-registers as member
export AGENTBOARD_PRODUCT=my-product       # default product slug
# export AGENTBOARD_BOARD=ops              # optional: override the product's default board
```

Without `AGENTBOARD_BOARD` or `--board`, the CLI uses the product's default board (Settings → Agent default board). A product with a single board needs no default. A product with several boards and no default makes the CLI stop and list them.

### Commands

```bash
# List tasks
agentboard list
agentboard list --include-done

# Create a task
agentboard new "Build the login page"
agentboard new "Fix auth bug" --priority urgent --assignee MyAgent --due 2026-03-15

# Update status
# Statuses: backlog | todo | doing | in-progress | in-review | done | blocked
agentboard status <id> doing
# A board made before Blocked was a default column needs one first:
#   agentboard column add "Blocked" --color "#EF4444"
agentboard status <id> done

# View task details
agentboard show <id>

# Rename a task
agentboard rename <id> "New title"

# Manage notes
agentboard notes <id>                     # view notes
agentboard notes <id> --set "Full text"   # replace notes
agentboard notes <id> --append "More"     # append to notes

# Toggle attention flag
agentboard attention <id> on
agentboard attention <id> off

# Sub-tasks: a checklist on a card
agentboard subtask add <card-id> "Write the migration"
agentboard subtask list <card-id>         # [x]/[ ] per item, then "1/3 done"
agentboard subtask done <subtask-id>      # or: undo
agentboard subtask rename <subtask-id> "New title"
agentboard subtask remove <subtask-id>
```

### Output Flags

- `--json` — JSON output for programmatic use
- `--quiet` — minimal output (IDs only)

The commands above are the common ones. The CLI also has full CRUD subcommands
for orgs, products, boards, columns, members, tasks, sub-tasks, attachments, settings and
preferences — see [cli/README.md](cli/README.md) for the complete reference.

## API Reference

All API routes require authentication via cookie or `Authorization: Bearer <password>` header when `APP_PASSWORD` is set. If `APP_PASSWORD` is unset, all routes are open.

### Auth

```
POST /api/auth/login     { password }
POST /api/auth/logout
```

### Organizations

```
GET    /api/orgs
POST   /api/orgs           { name, slug? }
PATCH  /api/orgs/:id       { name }
DELETE /api/orgs/:id
PATCH  /api/orgs/reorder   { ids: [1, 2, 3] }
```

### Products

```
GET    /api/products?org_id=
GET    /api/products/by-slug?org_slug=&product_slug=
POST   /api/products         { org_id, name, emoji? }   # emoji auto-picked from name if omitted
PATCH  /api/products/:id     { name?, emoji? }
DELETE /api/products/:id
PATCH  /api/products/move    { product_id, org_id, position? }
PATCH  /api/products/reorder { ids: [1, 2, 3] }
```

### Boards

```
GET    /api/boards?product_id=
GET    /api/boards/:id
POST   /api/boards         { product_id, name }
PATCH  /api/boards/:id     { name?, position? }
DELETE /api/boards/:id
PATCH  /api/boards/reorder { ids: [1, 2, 3] }
```

### Columns

```
GET    /api/columns?board_id=
GET    /api/columns/by-card/:id
POST   /api/columns       { board_id, name }
PATCH  /api/columns/:id   { name?, position?, color? }
DELETE /api/columns/:id
```

### Cards

```
GET    /api/cards?board_id=&column_id=&assignee=&priority=&label=
POST   /api/cards          { column_id, title, description?, assignee?, priority?, labels?, github_issue_url?, github_pr_url?, due_date? }
GET    /api/cards/:id
PATCH  /api/cards/:id      { ...partial update }
DELETE /api/cards/:id
PATCH  /api/cards/:id/move { column_id, position? }
PATCH  /api/cards/reorder  { ids: [1, 2, 3] }
GET    /api/cards/views?view=today|past-due|past-due-count|assigned&tz=&member_id=
```

Card creation accepts an `X-Agent-Name` header. The named agent is registered
as a member on first use and assigned to the card.

### Live updates

One request for everything a board screen renders, and one event stream that
says when to ask again.

```
GET /api/board?product_id=1
GET /api/board?product_id=1&board_id=4
GET /api/board?product_id=1&board_id=4&updated_since=<server_time>

GET /api/stream              # every board
GET /api/stream?board_id=4   # one board
```

`GET /api/board` returns `{ server_time, boards, active_board_id, columns, cards }`.
Boards and columns always come back whole — they are a handful of rows, and
filtering them would only cost the client a second reconciliation path.

Pass the `server_time` from the previous response back as `updated_since` and
`cards` narrows to what changed, alongside `card_ids`: every card id on the
board, in order. That list is how a delta reports a deletion, since a row that
no longer exists can never appear in a "changed since" result — reconcile
membership from the ids rather than inferring it from the changes. Treat
`server_time` as an opaque cursor; it is the database's clock, not the caller's.

The response also carries a weak `ETag`, so an unchanged board answers
`If-None-Match` with a `304` and an empty body.

`GET /api/stream` is Server-Sent Events. It carries invalidation, not data:

```
event: hello       data: {"board_id":4,"mode":"listen"}
event: change      data: {"board_id":4}
event: reconnect   data: {"reason":"max-duration"}
```

A `change` event means "fetch a delta", which keeps live updates and reconnect
catch-up on the same code path. `mode` reports whether the server is sourcing
changes from `LISTEN/NOTIFY` or falling back to polling — see
`DIRECT_POSTGRES_URL`. The server closes the stream on its own schedule and
sends `reconnect` first, so a platform timeout never cuts a response mid-write;
reconnect and resume from your last cursor.

### Sub-tasks

```
GET    /api/cards/:id/subtasks
POST   /api/cards/:id/subtasks     { title, done? }       # added to the end
GET    /api/subtasks/:id
PATCH  /api/subtasks/:id           { title?, done? }
DELETE /api/subtasks/:id
```

Titles are one line (newlines become spaces), trimmed, and at most 500
characters; `done` must be a boolean. Unknown fields in a PATCH are a 400.
Every write bumps the card's `updated_at` and notifies the board, so live
views pick it up. Board cards and `GET /api/cards/:id` include
`subtask_total` and `subtask_done`.

### Attachments

```
GET    /api/cards/:id/attachments
POST   /api/cards/:id/attachments  { filename, content }   # content capped at 1 MiB
DELETE /api/attachments/:id
```

### Members, Settings & Preferences

```
GET    /api/members
POST   /api/members       { name, type?, color?, avatar_url? }
PATCH  /api/members/:id   { name?, type?, color?, avatar_url? }
DELETE /api/members/:id

GET    /api/settings
PATCH  /api/settings      { key, value }

GET    /api/preferences
PATCH  /api/preferences   { key, value }
```

## Data Model

```
Organization
  └── Product
       └── Board (e.g. Development, Marketing, Sales)
            └── Column (e.g. Backlog, Todo, In Progress, Done)
                 └── Card
                      ├── assignee
                      ├── priority (low | medium | high | urgent)
                      ├── labels
                      ├── description
                      ├── due_date
                      ├── github_issue_url
                      ├── github_pr_url
                      ├── Sub-tasks (title, done)
                      └── Attachments
```

## Tech Stack

- **Framework:** Next.js 15 (App Router)
- **Styling:** Tailwind CSS v4
- **Database:** Postgres via `pg` (any Postgres — local, Neon, Supabase, RDS)
- **Drag & Drop:** @dnd-kit
- **Auth:** Single password, httpOnly cookie + Bearer token

## Security

AgentBoard uses a single shared password rather than per-user accounts. That is
a deliberate trade-off for a small self-hosted tool, and it shapes how you
should deploy it:

- **Set `APP_PASSWORD` on anything reachable from the internet.** With it unset
  the app is fully open — every board and every API route, no login. That mode
  is meant for localhost only.
- **Use a long, random password.** It doubles as the API bearer token, so treat
  it like an API key. The session cookie stores a SHA-256 derivation of it
  rather than the password itself, and comparisons are constant-time.
- **There is no per-user access control.** Anyone with the password can read and
  write every org, product, board and card.
- Requests are rejected when a browser sends a cross-site `Origin` on a
  state-changing request, and the session cookie is `httpOnly` + `SameSite=Lax`.
- Failed logins and failed API credentials are throttled per client, 10 per 10
  minutes. This is in-memory per instance, so treat it as friction rather than a
  guarantee.
- **Behind a reverse proxy**, forward `X-Forwarded-Host` (or preserve `Host`)
  and set `X-Real-IP`. The first is required for the origin check to pass, the
  second for throttling to tell clients apart. See [SECURITY.md](SECURITY.md).

Found a vulnerability? See [SECURITY.md](SECURITY.md).

## Using the core in another Next app

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

Every query the core runs is scoped to the `teamId` this returns, and it is the only place a team comes from. Throw a `TenantError` to refuse a request with that status (401, 402 for a lapsed subscription, 403); the route never runs. Teams are rows in the core's `teams` table, which your app creates (`ensureTeamDefaults` from `lib/tenancy` gives a new one the default boards and columns).

Without `configure()`, every request acts for the single self-hosted team, which is what self-hosted AgentBoard is. For a multi-team app that means a missed `configure()` fails open, so test that an unauthenticated request is refused. The self-hosted password check lives in `src/middleware.ts` and is not part of `configure()`; a consuming app authenticates in its resolver.

[test/consumer](test/consumer) is a working example, and CI builds and drives it (`scripts/verify-consumer.mjs`) against the lowest and newest supported Next 16.

## Roadmap

What is planned, what stays free, and where the line with the hosted edition
sits: [ROADMAP.md](ROADMAP.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). CLI releases are published to npm from `cli-v*` tags; see [RELEASING.md](RELEASING.md).

## License

Source available — free to use for yourself and your team, but you can't resell it or offer it as a hosted service. See [LICENSE](LICENSE) for details.

[deploy]: https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fstratuslabs%2Fagentboard&project-name=agentboard&repository-name=agentboard&stores=%5B%7B%22type%22%3A%22integration%22%2C%22integrationSlug%22%3A%22neon%22%2C%22productSlug%22%3A%22neon%22%2C%22protocol%22%3A%22storage%22%7D%5D&env=APP_PASSWORD&envDescription=Password%20protecting%20the%20board%20and%20its%20API.%20A%20deployment%20with%20this%20left%20blank%20is%20fully%20open%20to%20anyone%20with%20the%20URL.&envLink=https%3A%2F%2Fgithub.com%2Fstratuslabs%2Fagentboard%23security
