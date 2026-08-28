# AgentBoard

Lightweight kanban project management for AI agents and humans. Self-hostable, API-first, agent-friendly.

## Features

- **Kanban boards** — drag-and-drop cards across configurable columns
- **Multi-product** — organize projects under orgs and products
- **Agent-first CLI** — designed for AI agents to create, update, and query tasks
- **REST API** — every action is available via HTTP
- **Auth optional** — run open or protected with a single password
- **Vercel-ready** — deploy in minutes with Vercel Postgres
- **Self-hostable** — run locally with Docker

## Quick Start

### Local Development

**Prerequisites:** Node.js 18+, Docker

```bash
# 1. Clone
git clone git@github.com:dylanfeltus/agentboard.git
cd agentboard

# 2. Install dependencies
npm install

# 3. Start Postgres
docker-compose up -d

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

1. Fork this repo
2. Create a Vercel project and connect it to your fork
3. Add a Vercel Postgres database (Storage tab → Create Database)
4. Set environment variables (see table below)
5. Deploy — Vercel will run the build and your app will be live

After deploying, run the database setup:

```bash
# With Vercel CLI
vercel env pull .env.local
npm run db:setup
```

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `POSTGRES_URL` | Yes | Postgres connection string (pooled) |
| `POSTGRES_URL_NON_POOLING` | Yes | Postgres connection string (direct) |
| `APP_PASSWORD` | No | Single password for web UI and API. If unset, app is open (no auth) |
| `TZ` | No | Default timezone for date calculations (e.g. `America/New_York`) |

## CLI

Official install path, from a trusted checkout of this repo:

```bash
git clone git@github.com:dylanfeltus/agentboard.git
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
```

### Commands

```bash
# List tasks
agentboard list
agentboard list --include-done

# Create a task
agentboard new "Build the login page"
agentboard new "Fix auth bug"

# Update status
# Statuses: todo | doing | done | blocked
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
POST   /api/orgs          { name, slug? }
DELETE /api/orgs/:id
```

### Products

```
GET    /api/products?org_id=
POST   /api/products      { org_id, name, emoji? }
DELETE /api/products/:id
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
POST   /api/columns       { board_id, name }
PATCH  /api/columns/:id   { name?, position?, color? }
DELETE /api/columns/:id
```

### Cards

```
GET    /api/cards?board_id=&column_id=&assignee=&priority=&label=
POST   /api/cards          { column_id, title, description?, assignee?, priority?, labels?, github_issue_url?, github_pr_url? }
GET    /api/cards/:id
PATCH  /api/cards/:id      { ...partial update }
DELETE /api/cards/:id
PATCH  /api/cards/:id/move { column_id, position? }
```

### Attachments

```
GET    /api/cards/:id/attachments
POST   /api/cards/:id/attachments  { filename, content }
DELETE /api/attachments/:id
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
                      ├── notes
                      ├── github_issue_url
                      ├── github_pr_url
                      └── Attachments
```

## Tech Stack

- **Framework:** Next.js 15 (App Router)
- **Styling:** Tailwind CSS v4
- **Database:** Postgres via `@vercel/postgres`
- **Drag & Drop:** @dnd-kit
- **Auth:** Single password, httpOnly cookie + Bearer token

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Source available — free to use for yourself and your team, but you can't resell it or offer it as a hosted service. See [LICENSE](LICENSE) for details.
