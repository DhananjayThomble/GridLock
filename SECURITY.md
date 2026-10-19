# Security Policy

## Reporting a Vulnerability

Please **do not** open a public issue for security vulnerabilities.

Report them privately through GitHub's
[private vulnerability reporting](https://github.com/DhananjayThomble/GridLock/security/advisories/new)
(Security tab → "Report a vulnerability").

Please include:

- A description of the issue and its impact
- Steps to reproduce, or a proof of concept
- Affected endpoints, socket events, or files, if known

You can expect an initial response within a few days. Please give us a
reasonable amount of time to fix the issue before disclosing it publicly.

## Scope

In scope: the code in this repository and the live deployment at
`gridlock.pro` / `api.gridlock.pro`.

Out of scope: denial-of-service or load testing against the live site,
social engineering, and findings in third-party services.

## Note on Public Keys

The PostHog project key and Sentry DSN in `frontend/.env.production` are
client-side identifiers that ship in the browser bundle by design. They are
not secrets.
