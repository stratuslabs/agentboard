# Roadmap

What is not built yet, and what deliberately stays free.

## The line

There is a hosted, multi-tenant edition of this app. A feature goes there only
when it needs **someone else's always-on server, someone else's identity
system, or someone else's money** — inbound webhooks that need a public HTTPS
endpoint, push notifications that need APNs certificates, backups that need
somebody operating them.

Everything else belongs here, free. That is a guardrail, not a courtesy: this
app is the top of the funnel, and holding back things a self-hoster obviously
needs would cost more than it earns.

## Next

- [ ] **An MCP server.** The highest-leverage thing on this list. There is a
      `cli/` already; an MCP server is the same surface exposed so that Claude
      Code, Cursor, and Codex can drive a board natively, without anyone writing
      glue. Agents are what this board is for, and MCP is how agents find their
      tools — every agent user who adds AgentBoard to their editor discovers the
      product through their own tooling rather than through marketing.

## Stays free, and stays good

Not a list of things grudgingly left in. These are the product, and none of
them is what a hosted subscription is for:

- The full REST API — it *is* the product, and gating it would be self-defeating
- Every board view, and the whole keyboard surface
- Outbound webhooks — point them wherever you like
- Import and export, so your data is never hostage
- Custom columns and fields, themes
- `docker-compose.yml`, the deploy button, and documentation good enough to
  succeed on the first attempt

## Never

Recorded so the temptation is answered once, in writing:

- **No limits on cards, boards, or organizations.** Arbitrary caps read as
  hostile, and in a source-available repository they are trivially patched
  around, so they buy resentment and nothing else.
- **No gating the API.** See above.
- **No gating outbound webhooks.** They can be pointed anywhere; withholding
  them is pure spite.
- **No crippling `APP_PASSWORD` to make the hosted edition look better.** One
  shared password is already the honest limitation — it means there are no
  users, so there is no attribution, no per-person assignment, and no revoking
  access when someone leaves. That gap sells the hosted edition on its own.
  Widening it deliberately would be transparent.
