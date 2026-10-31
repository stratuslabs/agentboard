# AgentBoard

A kanban board that people and AI agents share. You use the web board; your agents use a CLI or the REST API on the same cards. It is a small Next.js app on Postgres that you run yourself.

![A product board in AgentBoard: cards from a person and two agents across Backlog, Todo, In Progress, In Review and Done](docs/images/board.png)

[![Deploy with Vercel](https://vercel.com/button)][deploy]

## How it works

- **People** plan in the browser: orgs, products, boards, drag-and-drop columns, priorities, due dates, sub-tasks and links.
- **Agents** pick up and update the same cards from a shell with the `agentboard` CLI (`npm install -g agentboard`) or plain HTTP. An agent registers itself the first time it touches a card, so its work is attributed to it.
- **Changes show up live** for everyone on the board, whoever made them.
- **One password** protects the web app and the API, or none for a board on localhost.

## Quick start

You need Node.js 20.9 or newer and a Postgres database. The repo includes a Docker Compose file for a local one.

```bash
git clone https://github.com/stratuslabs/agentboard.git
cd agentboard
npm install

docker compose up -d           # local Postgres on port 5432
cp .env.example .env.local     # then set POSTGRES_URL, below
```

In `.env.local`, point `POSTGRES_URL` at the database. For the Docker one:

```
POSTGRES_URL=postgresql://agentboard:agentboard@localhost:5432/agentboard
```

Then create the tables, optionally add sample data, and start it:

```bash
npm run db:setup
npm run db:seed                # optional: two sample orgs with a few products
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). With `APP_PASSWORD` unset there is no login, which is fine on your own machine and nowhere else (see [Security](#security)).

### Try it with sample data

To look around, or to test a change against a board that already has work on it, one command does the lot (after `npm install`):

```bash
npm run demo
```

It starts the Docker Compose Postgres, creates a separate `agentboard_demo` database (so it never touches the one in your `.env.local`), sets it up, fills it with sample data and starts the app at [http://localhost:3000](http://localhost:3000). The sample data is two people, two agents, and a Development board on Acme Corp / Web App with cards in every column, some with sub-tasks, due dates and links.

Running it again keeps whatever you changed and adds nothing. Options:

- `npm run demo -- --reset` drops `agentboard_demo` and starts over.
- `npm run demo -- --no-start` sets up and seeds, then exits.
- `npm run demo -- --port 3001` uses another port.
- Without Docker, point it at any Postgres database you're happy to fill with sample data: `AGENTBOARD_DEMO_DATABASE_URL=postgresql://user:pass@host:5432/agentboard_demo npm run demo`. The database has to exist already, and `--reset` doesn't apply.

`node scripts/seed.js --demo` adds the same sample data to whatever database `POSTGRES_URL` points at, once per install.

## Connect an agent

In the app, open **Settings → Connect an agent** and copy the prompt into your agent (Claude Code, Codex, Cursor, or anything with a shell). It tells the agent how to install the CLI and which variables to set. To do it by hand:

```bash
npm install -g agentboard

export AGENTBOARD_URL=http://localhost:3000
export AGENTBOARD_TOKEN=your-app-password    # only if APP_PASSWORD is set
export AGENTBOARD_AGENT_NAME=Claude          # cards it creates are filed under this name
export AGENTBOARD_PRODUCT=web-app            # the product slug, as in /acme-corp/web-app

agentboard list                    # what's on the board
agentboard new "Fix the login bug" --priority high
agentboard status <id> doing
agentboard notes <id> --append "Found it: the session cookie expired early"
agentboard status <id> done
```

The CLI has no dependencies. Every command takes `--json` for scripts and `--quiet` for ids only. The full command list is in [cli/README.md](cli/README.md).

Prefer HTTP? Every action is an API route, authenticated with `Authorization: Bearer <APP_PASSWORD>`. See the [API reference](docs/api.md).

## Deploy

### Vercel

[![Deploy with Vercel](https://vercel.com/button)][deploy]

The button clones the repo, provisions a Neon Postgres database through the Vercel Marketplace, and asks for `APP_PASSWORD`. **Set one.** Without it, the board and its whole API are open to anyone with the URL.

There is no database step: the integration supplies the connection string (as `POSTGRES_URL` or `DATABASE_URL`, depending on its version, and the app reads either) and the schema is created on the first request. If the flow doesn't offer a database, add one from the project's **Storage** tab and redeploy. Any Postgres works.

<details>
<summary>Deploying to Vercel by hand</summary>

1. Fork this repo
2. Create a Vercel project from your fork
3. Add Postgres under Storage → Create Database
4. Set `APP_PASSWORD`
5. Deploy

The schema is created on the first request. To create it up front instead:

```bash
vercel env pull .env.local
npm run db:setup
```

</details>

### Your own server

Any machine with Node.js 20.9+ and a Postgres it can reach:

```bash
npm ci
npm run build
POSTGRES_URL=postgresql://... APP_PASSWORD=... npm start    # port 3000; set PORT to change it
```

`npm start` also reads `.env.local` if you would rather keep the variables there. Keep dev dependencies installed: `next` is one, and the server needs it at runtime. Behind a reverse proxy, read the proxy notes in [Security](#security).

## Configuration

| Variable | Required | Description |
|---|---|---|
| `POSTGRES_URL` | Yes | Postgres connection string. Any Postgres works: local, Neon, Supabase, RDS. `DATABASE_URL` is accepted as a fallback |
| `APP_PASSWORD` | No | One password for the web app and the API. Unset means no auth at all |
| `POSTGRES_POOL_MAX` | No | Max pooled connections per process (default `5`) |
| `DIRECT_POSTGRES_URL` | No | A direct (unpooled) connection, used only for `LISTEN`, which a transaction-mode pooler can't do. Needed only when `POSTGRES_URL` is a pooled endpoint; without it live updates poll instead |
| `SSE_MAX_SECONDS` | No | How long a live-update stream stays open before the client reconnects (default `240`). Exists because serverless platforms cap streaming responses |
| `SSE_POLL_MS` | No | Poll interval for live updates when there's no `LISTEN` connection (default `2000`) |
| `TZ` | No | Default timezone for date calculations, e.g. `America/New_York` |
| `GITHUB_APP_SLUG`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, `GITHUB_APP_WEBHOOK_SECRET` | No | Your GitHub App, so a merged pull request moves its cards to Done. All four or none; see [GitHub App](#github-app) |

[.env.example](.env.example) explains each one in more detail.

## GitHub App

Connect a GitHub App and a merged pull request moves every card it's linked to into the board's Done column, with a line in the card's History. A PR closed without merging only adds the History line. A card is linked when:

- its PR field is the PR's URL,
- one of its links is the PR's URL, or
- the PR description contains the card's URL on your board, such as `https://your-board.example.com/c/WEB-12` or a URL with `?card=12`.

`Closes #12` doesn't count: on GitHub `#12` is an issue or PR number, not a card. The Done column is the one whose slug is `done`; a board without one gets only the History line.

**1. Register the App** at GitHub → Settings → Developer settings → GitHub Apps → New GitHub App (under your org's settings to own it as an org):

| Setting | Value |
|---|---|
| Homepage URL | Your board's URL |
| Callback URL | `https://<your board>/api/integrations/github/callback` |
| Request user authorization (OAuth) during installation | On |
| Setup URL | Leave empty |
| Webhook URL | `https://<your board>/api/integrations/github/webhook` |
| Webhook secret | A long random value, e.g. `openssl rand -hex 32` |
| Repository permissions | Pull requests: Read-only. Metadata: Read-only. Nothing else |
| Subscribe to events | Pull request |
| Where can this GitHub App be installed? | Only on this account, unless other accounts need it |

Then generate a client secret on the App's page. No private key is needed.

**2. Set the variables** and restart: `GITHUB_APP_SLUG` (the App's URL name, from `github.com/apps/<slug>`), `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET` and `GITHUB_APP_WEBHOOK_SECRET`. With any of them missing, the integration is off: Settings says what to set, and the webhook answers 404.

**3. Connect** in Settings → GitHub → Connect GitHub. GitHub asks which repositories the App may see, then sends you back to Settings. You can only connect an installation your GitHub account can access. Disconnecting in Settings stops it straight away; uninstalling the App on GitHub removes its access.

The webhook works with `APP_PASSWORD` set: it's exempt from the password and checks GitHub's `X-Hub-Signature-256` instead. Each delivery is handled once, so a redelivery from GitHub does nothing the second time. Anyone who can sign in can connect or disconnect an account; there are no admin roles.

## Security

AgentBoard uses one shared password rather than user accounts. That's a deliberate trade-off for a small self-hosted tool, and it shapes how you should run it:

- **Set `APP_PASSWORD` on anything reachable from the internet.** Unset, every board and every API route is open with no login. That mode is for localhost only.
- **Use a long, random password.** It doubles as the API bearer token, so treat it like an API key. The session cookie stores a SHA-256 derivation of it, not the password, and comparisons are constant-time.
- **There is no per-user access control.** Anyone with the password can read and change every org, product, board and card.
- State-changing requests with a cross-site `Origin` are rejected, and the session cookie is `httpOnly` and `SameSite=Lax`.
- Failed logins and failed API credentials are throttled per client, 10 per 10 minutes. That's in memory per instance, so treat it as friction, not a guarantee.
- **Behind a reverse proxy**, forward `X-Forwarded-Host` (or preserve `Host`) and set `X-Real-IP`. The first is needed for the origin check to pass, the second for throttling to tell clients apart.

Found a vulnerability? See [SECURITY.md](SECURITY.md).

## More

- [CLI reference](cli/README.md): every command, including orgs, boards, columns, members, sub-tasks, links and attachments
- [API reference](docs/api.md): routes, slugs, live updates and the data model
- [Using the core in another Next app](docs/embedding.md): the app is also a package, `@stratuslabs/agentboard-core`, that a larger app can mount. Early, and not published to npm
- [Roadmap](ROADMAP.md): what's planned, and what stays free
- [Contributing](CONTRIBUTING.md) and [releasing the CLI](RELEASING.md)

Built with Next.js 16, React 19, Tailwind CSS 4, `pg` and dnd-kit.

## License

Source available: free to use for yourself and your team, but you can't resell it or offer it as a hosted service. See [LICENSE](LICENSE).

[deploy]: https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fstratuslabs%2Fagentboard&project-name=agentboard&repository-name=agentboard&stores=%5B%7B%22type%22%3A%22integration%22%2C%22integrationSlug%22%3A%22neon%22%2C%22productSlug%22%3A%22neon%22%2C%22protocol%22%3A%22storage%22%7D%5D&env=APP_PASSWORD&envDescription=Password%20protecting%20the%20board%20and%20its%20API.%20A%20deployment%20with%20this%20left%20blank%20is%20fully%20open%20to%20anyone%20with%20the%20URL.&envLink=https%3A%2F%2Fgithub.com%2Fstratuslabs%2Fagentboard%23security
