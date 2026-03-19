# AgentBoard

Lightweight project management web app with CLI. Kanban boards per product, organized by LLC. Agent-friendly.

## Quick Start

### Prerequisites

- Node.js 18+
- npm

### Setup

```bash
# Install dependencies
npm install

# Set your password (optional — if unset, no auth required)
echo "APP_PASSWORD=your-secret-password" > .env

# Initialize the database
npm run db:setup

# Seed with sample data
npm run db:seed

# Start the dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and log in with your password.

### Environment Variables

| Variable | Description | Required |
|---|---|---|
| `APP_PASSWORD` | Single password for web UI and API auth | No (open access if unset) |
| `AGENTBOARD_DB` | Path to SQLite database file | No (defaults to `./agentboard.db`) |

## Data Model

```
Organization (LLC)
  └── Product
       └── Board (Development, Marketing, Sales, Support)
            └── Column (Backlog, Todo, In Progress, In Review, Done)
                 └── Card
```

## CLI Usage

The CLI works in two modes:

- **Local mode** — set `AGENTBOARD_DB` to use SQLite directly (fast, for local agents)
- **Remote mode** — set `AGENTBOARD_URL` + `AGENTBOARD_PASSWORD` to hit the HTTP API

```bash
# Install globally (optional)
npm link

# Or run directly
node bin/agentboard.js <command>
```

### Organizations

```bash
agentboard org list
agentboard org add "Stratus Labs"
agentboard org remove stratus-labs
```

### Products

```bash
agentboard product list [--org stratus-labs]
agentboard product add --org stratus-labs "Kaboodle" --emoji "🧶"
agentboard product remove kaboodle
```

### Tasks (Cards)

```bash
# Add a task
agentboard task add --product kaboodle --board marketing "Write launch post" \
  --assignee "Mia" --priority high --label "content,launch" \
  --description "Draft a launch announcement for Product Hunt"

# List tasks
agentboard task list --product kaboodle --board dev \
  [--assignee "Builder"] [--priority high] [--column todo]

# Update tasks
agentboard task move <card-id> --column in-progress
agentboard task update <card-id> --assignee "Juno" --priority urgent
agentboard task done <card-id>
agentboard task show <card-id>
agentboard task remove <card-id>

# GitHub links
agentboard task link <card-id> --issue "https://github.com/org/repo/issues/42"
agentboard task link <card-id> --pr "https://github.com/org/repo/pull/15"

# Attachments
agentboard task attach <card-id> --file ./spec.md
agentboard task attachments <card-id>

# Views
agentboard board --product kaboodle --board dev
agentboard my-tasks --assignee "Claudia"
```

### Output Flags

- `--json` — JSON output for programmatic use
- `--quiet` — minimal output (just IDs)

## API Reference

All API routes require authentication via cookie or `Authorization: Bearer <password>` header.

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
PATCH  /api/cards/:id      { ...partial update }
DELETE /api/cards/:id
PATCH  /api/cards/:id/move { column_id, position }
```

### Attachments

```
GET    /api/cards/:id/attachments
POST   /api/cards/:id/attachments  { filename, content }
DELETE /api/attachments/:id
```

## Self-Hosting

### With Node.js

```bash
git clone <repo-url>
cd agentboard
npm install
echo "APP_PASSWORD=your-password" > .env
npm run db:setup
npm run db:seed
npm run build
npm start
```

### With Vercel

1. Fork/clone the repo
2. Connect to Vercel
3. Set `APP_PASSWORD` in environment variables
4. Deploy

Note: For Vercel deployment, you'll need to use an external database since the filesystem is ephemeral. The SQLite setup works for self-hosted deployments.

## Tech Stack

- **Framework:** Next.js 15 (App Router)
- **Styling:** Tailwind CSS v4
- **Database:** SQLite via better-sqlite3
- **Drag & Drop:** @dnd-kit
- **Auth:** Single password, httpOnly cookie

## License

MIT
