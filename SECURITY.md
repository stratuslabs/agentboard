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

Reports about these behaviours are welcome as feature requests, but they are
documented trade-offs rather than defects.
