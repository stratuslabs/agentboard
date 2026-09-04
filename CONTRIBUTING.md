# Contributing to AgentBoard

Thanks for your interest! AgentBoard is a small, focused project — contributions are welcome.

## Dev Environment

**Prerequisites:** Node.js 20+, Docker (for local Postgres)

```bash
# 1. Clone the repo
git clone https://github.com/stratuslabs/agentboard.git
cd agentboard

# 2. Install dependencies
npm install

# 3. Start Postgres
docker compose up -d

# 4. Copy env vars and configure
cp .env.example .env.local
# Edit .env.local:
#   POSTGRES_URL=postgresql://agentboard:agentboard@localhost:5432/agentboard

# 5. Initialize the database
npm run db:setup

# 6. (Optional) Seed with sample data
npm run db:seed

# 7. Start the dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). If `APP_PASSWORD` is not set, no login is required.

## PR Guidelines

- **Create a branch** — don't commit directly to `main`
- **Describe your changes** — what problem does the PR solve?
- **Keep PRs focused** — one feature or fix per PR
- **Test locally** — make sure the app runs before submitting

## Project Structure

```
src/app/          Next.js App Router pages and API routes
src/components/   React components (kanban board, sidebar, modals)
src/lib/          Shared utilities (auth, db, helpers)
scripts/          Database setup and seeding
cli/              Canonical CLI package and implementation
```

## Questions?

Open an issue or start a discussion on GitHub.
