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
#   POSTGRES_URL_NON_POOLING=postgresql://agentboard:agentboard@localhost:5432/agentboard

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

There is no database setup step: the integration supplies `POSTGRES_URL`, and
the schema is created on the first request.

If the flow does not offer to create a database, add one afterwards from the
project's **Storage** tab and redeploy — any Postgres works, and the schema is
still created on the first request.

<details>
<summary>Deploying manually instead</summary>

1. Fork this repo
2. Create a Vercel project and connect it to your fork
3. Add Postgres under Storage → Create Database (the Neon integration sets
   `POSTGRES_URL` for you)
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
| `POSTGRES_URL` | Yes | Postgres connection string. Any Postgres works. Set for you by the Vercel/Neon integration |
| `POSTGRES_POOL_MAX` | No | Max pooled connections per process (default `5`) |
| `APP_PASSWORD` | No | Single password for web UI and API. If unset, app is open (no auth) |
| `TZ` | No | Default timezone for date calculations (e.g. `America/New_York`) |

## CLI

Official install path, from a trusted checkout of this repo:

```bash
git clone https://github.com/stratuslabs/agentboard.git
cd agentboard
npm install
npm install -g ./cli
```

The CLI source of truth lives in `cli/agentboard.js`. The root `bin/agentboard.js` is just a compatibility wrapper.

Configure it:

```bash
export AGENTBOARD_URL=https://your-instance.vercel.app
export AGENTBOARD_PASSWORD=your-password   # if APP_PASSWORD is set
export AGENTBOARD_AGENT_NAME=MyAgent       # auto-registers as member
export AGENTBOARD_PRODUCT=my-product       # default product slug
export AGENTBOARD_BOARD=development        # default board slug (defaults to 'development')
```

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
```

### Output Flags

- `--json` — JSON output for programmatic use
- `--quiet` — minimal output (IDs only)

The commands above are the common ones. The CLI also has full CRUD subcommands
for orgs, products, boards, columns, members, tasks, attachments, settings and
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
POST   /api/products         { org_id, name, emoji? }
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

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Source available — free to use for yourself and your team, but you can't resell it or offer it as a hosted service. See [LICENSE](LICENSE) for details.

[deploy]: https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fstratuslabs%2Fagentboard&project-name=agentboard&repository-name=agentboard&stores=%5B%7B%22type%22%3A%22integration%22%2C%22integrationSlug%22%3A%22neon%22%2C%22productSlug%22%3A%22neon%22%2C%22protocol%22%3A%22storage%22%7D%5D&env=APP_PASSWORD&envDescription=Password%20protecting%20the%20board%20and%20its%20API.%20A%20deployment%20with%20this%20left%20blank%20is%20fully%20open%20to%20anyone%20with%20the%20URL.&envLink=https%3A%2F%2Fgithub.com%2Fstratuslabs%2Fagentboard%23security
