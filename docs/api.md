# AgentBoard API reference

Every action in the web app is an HTTP call you can make yourself. The [CLI](../cli/README.md) is a thin client over these routes.

All API routes require authentication via cookie or `Authorization: Bearer <password>` header when `APP_PASSWORD` is set. If `APP_PASSWORD` is unset, all routes are open.

Errors are JSON, `{ "error": "..." }`. A path no route serves is a `404`
(`No API route for GET /api/tasks`), never the app's HTML.

The list endpoints take a slug wherever they take an id: `org=` for `org_id=`,
`product=` for `product_id=`, `board=` for `board_id=`, `column=` for
`column_id=`. Slugs are unique within their parent, so a board or column slug
needs its parent too, and a product slug used in more than one organization
needs `org=`:

```
GET /api/boards?product=agentboard
GET /api/columns?product=agentboard&board=development
GET /api/cards?org=labs&product=agentboard&board=development&column=todo
```

A slug that matches nothing is a `404` naming it. Pass an id or a slug for a
level, not both.

## Auth

```
POST /api/auth/login     { password }
POST /api/auth/logout
```

## Organizations

```
GET    /api/orgs
POST   /api/orgs           { name, slug? }
PATCH  /api/orgs/:id       { name }
DELETE /api/orgs/:id
PATCH  /api/orgs/reorder   { ids: [1, 2, 3] }
```

## Products

```
GET    /api/products?org_id=|org=
GET    /api/products/by-slug?org_slug=&product_slug=
POST   /api/products         { org_id, name, emoji? }   # emoji auto-picked from name if omitted
PATCH  /api/products/:id     { name?, emoji? }
DELETE /api/products/:id
PATCH  /api/products/move    { product_id, org_id, position? }
PATCH  /api/products/reorder { ids: [1, 2, 3] }
```

## Boards

```
GET    /api/boards?product_id=|product=   # product= may need org=
GET    /api/boards/:id
POST   /api/boards         { product_id, name }
PATCH  /api/boards/:id     { name?, position? }
DELETE /api/boards/:id
PATCH  /api/boards/reorder { ids: [1, 2, 3] }
```

## Columns

```
GET    /api/columns?board_id=|board=      # board= needs product= or product_id=
GET    /api/columns/by-card/:id
POST   /api/columns       { board_id, name }
PATCH  /api/columns/:id   { name?, position?, color? }
DELETE /api/columns/:id
```

## Cards

```
GET    /api/cards?org=&product=&board_id=|board=&column_id=|column=&assignee=&priority=&label=
POST   /api/cards          { column_id, title, description?, assignee?, priority?, labels?, github_issue_url?, github_pr_url?, due_date? }
GET    /api/cards/:id
PATCH  /api/cards/:id      { ...partial update }
DELETE /api/cards/:id
PATCH  /api/cards/:id/move { column_id, position? }
PATCH  /api/cards/reorder  { ids: [1, 2, 3] }
GET    /api/cards/views?view=today|past-due|past-due-count|assigned&tz=&member_id=
```

Card creation accepts an `X-Agent-Name` header. The named agent is registered
as a member on first use and assigned to the card, unless the request names
an `assignee` or `assignee_id`, which always wins. Agent names are unique per
team in any case, so `claude` and `Claude` are one agent, and registering an
agent that exists (`POST /api/members` with `type: "agent"`) returns it with
`200` instead of adding another. People may share a name.

Every card these routes return, alone or in a list, includes `url`, and so
does every card in a `GET /api/board` snapshot or delta. It's the card's
permanent link, `<origin>/c/<id>`, which opens the card wherever it lives. The
origin is the one the request reached. Behind a reverse proxy, forward
`X-Forwarded-Host` (browser writes already need it to pass the origin check)
and `X-Forwarded-Proto`, and links use your public domain.

## Live updates

One request for everything a board screen renders, and one event stream that
says when to ask again.

```
GET /api/board?product_id=1
GET /api/board?product_id=1&board_id=4
GET /api/board?product_id=1&board_id=4&updated_since=<server_time>
GET /api/board?product=agentboard&board=development

GET /api/stream              # every board
GET /api/stream?board_id=4   # one board
```

`GET /api/board` returns `{ server_time, boards, active_board_id, columns, cards }`.
A `board_id` that no longer exists opens the product's first board; a `board=`
slug that matches nothing is a `404`.
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

## Sub-tasks

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

## Links

```
GET    /api/cards/:id/links
POST   /api/cards/:id/links    { url, title? }    # 201 new, 200 already linked
DELETE /api/cards/:id/links    { url }
```

A link is any absolute `http://` or `https://` URL, up to 2048 characters;
other schemes are a 400. A card holds each URL once: posting a URL it already
has keeps one link and replaces its title if you send one. Titles are one
line, at most 200 characters. Every write bumps the card's `updated_at` and
notifies the board. The GitHub issue and PR stay separate card fields
(`github_issue_url`, `github_pr_url`).

## Attachments

```
GET    /api/cards/:id/attachments
POST   /api/cards/:id/attachments  { filename, content }   # content capped at 1 MiB
GET    /api/attachments/:id        # one attachment, with its content
DELETE /api/attachments/:id
```

## Members, Settings & Preferences

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

## GitHub App

Off unless all four `GITHUB_APP_*` variables are set; see the README's [GitHub App](../README.md#github-app) section.

```
GET    /api/integrations/github                      → { enabled, installations: [{ installation_id, account_login, created_at }] }
DELETE /api/integrations/github?installation_id=N    disconnect it from this board
GET    /api/integrations/github/connect              302 to GitHub's install page (browser only)
GET    /api/integrations/github/callback             where GitHub returns; 303 to /settings#github
POST   /api/integrations/github/webhook              GitHub only; checked with X-Hub-Signature-256, not APP_PASSWORD
```

## Data model

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
