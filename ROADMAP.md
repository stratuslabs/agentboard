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

      It lands here, free, as `mcp/` alongside `cli/` — published to npm as
      `agentboard-mcp`, a stdio server that points at whatever `AGENTBOARD_URL`
      you give it. That is not generosity, it is the line above applied
      honestly: a stdio server is a program on your own machine talking to a URL
      you chose, so it needs nobody else's server, identity or money, and gating
      it would be gating the API by another name — which is already on the Never
      list.

      What the hosted edition adds is the **hosting**, not the protocol: a
      remote endpoint you connect to with a pasted URL and one OAuth click
      instead of an npm install and a key in a dotfile. That needs an always-on
      public HTTPS endpoint and an authorization server with real accounts
      behind it, which is exactly the test. The tool definitions are shared —
      one module, no transport coupling — so the two editions cannot drift the
      way `cli/` already has.

      Design it for roughly ten tools, not for the CLI's forty subcommands.
      Every tool definition costs context on every turn, and tool-selection
      accuracy falls off as the list grows; a board that is expensive to have
      connected is a board people disconnect.

- [x] **Publish the CLI to npm** — done, `agentboard`. The setup prompt now
      installs it in one line instead of cloning a whole web application to
      get one dependency-free script.

      It shipped first as `@stratuslabs/agentboard`, because the unscoped name
      belonged to an unrelated package abandoned a day after it was published.
      Its owner handed the name over, so the scoped package is deprecated and
      points here. His `0.3.1` and `0.4.0` are still on the registry and always
      will be — npm only permits unpublish within 72 hours — so this CLI starts
      at `0.9.0`, which clears `0.4.0` and therefore takes the `latest` tag,
      and anything below it is deprecated with a note saying it is different
      software. Not `1.0.0`: SECURITY.md says AgentBoard is pre-1.0, and the
      version on the package is the wrong place to contradict it. 1.0.0 is
      worth reaching deliberately, once the launch list above is done.

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
