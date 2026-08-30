# Security Policy

## Supported Versions

AgentBoard is pre-1.0. Security fixes land on `main`; there are no backports to
older tags. Run the latest `main` for a deployment you expose to the internet.

## Reporting a Vulnerability

**Please do not open a public issue for security reports.**

Report privately through GitHub's
[private vulnerability reporting](https://github.com/stratuslabs/agentboard/security/advisories/new)
on this repository. Include:

- what the issue is and where in the code it lives
- steps to reproduce, or a proof of concept
- what an attacker gets out of it

We aim to acknowledge within 5 business days and to ship a fix or a plan within
30 days. We will credit you in the advisory unless you would rather stay
anonymous.

## Running Behind a Reverse Proxy

Two protections depend on headers your proxy sets, so configure it to send them:

- `X-Forwarded-Host` (or a preserved `Host`) — used to validate the `Origin` of
  state-changing requests. nginx's `proxy_pass` rewrites `Host` to the upstream
  address by default; without one of these headers every write is rejected with
  403. In nginx: `proxy_set_header X-Forwarded-Host $host;` or
  `proxy_set_header Host $host;`.
- `X-Real-IP` (or `X-Forwarded-For`) — used to identify a client for login
  throttling. In nginx: `proxy_set_header X-Real-IP $remote_addr;`.

Your proxy must **set** these rather than pass through what the client sent.
`X-Forwarded-For` is client-appendable, so AgentBoard reads its last entry (the
one nearest to us) and prefers `X-Real-IP` where present. A deployment exposed
directly to the internet with no proxy has no trustworthy client address, and
throttling degrades to a single shared bucket.

## Database Connections

Connections are opened with `pg` over the Postgres wire protocol. TLS is decided
explicitly rather than left to the connection string:

- `sslmode=disable`, or no `sslmode` on a loopback host — plaintext, for local
  development.
- `sslmode=no-verify` — TLS without certificate verification.
- Anything else, **including a remote host whose URL omits `sslmode`** — TLS with
  certificate verification.

That last case is the point: `pg` on its own enables TLS only when the URL asks
for it, so a remote database reached by a URL missing `sslmode` would otherwise
be queried in plaintext.

## Deployment Expectations

Some things are by design, not vulnerabilities:

- **No password set = no auth.** With `APP_PASSWORD` unset the app is
  intentionally open. This is for local development. Set it on anything
  internet-reachable.
- **One shared password, no per-user accounts.** Anyone holding the password has
  full read/write access to every board. There is no roles or permissions model.
- **The password is also the API bearer token.** Rotating it invalidates every
  existing session and every configured CLI at once.
- **Attachments are stored inline in Postgres**, capped at 1 MiB each. There is
  no virus scanning or content inspection.
- **Login throttling is per-runtime-instance.** Failed attempts are counted in
  memory, so a serverless deployment bounds each warm instance rather than the
  whole deployment. Treat it as friction against naive guessing, not as a
  guarantee — the real defence is a long, random `APP_PASSWORD`.

Reports about these behaviours are welcome as feature requests, but they are
documented trade-offs rather than defects.
