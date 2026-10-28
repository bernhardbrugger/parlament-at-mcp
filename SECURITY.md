# Security Policy

`parlament-at-mcp` reads public data from the Austrian Parliament. It stores no user data and holds no credentials. Still, it parses
text from a third party and can be run as a network service, so security reports are welcome.

## Supported versions

Only the latest released version receives fixes.

## Reporting a vulnerability

Please do **not** open a public issue. Use GitHub's private vulnerability reporting:
**Security → Report a vulnerability** on the repository page. Include what you found, how to reproduce it and the affected version.

You can expect an acknowledgement within a few days. Fixes for confirmed problems are released as soon as they are ready, with a
note in `CHANGELOG.md`.

## What the server already does

- **Fixed destination:** the client only talks to `www.parlament.gv.at`; any other base URL is refused at construction.
- **No caller-controlled URLs:** legislative periods, citations, session numbers and document paths are validated against strict
  patterns before they are put into a request path.
- **Validated input and output:** tool arguments are checked with zod; API responses are validated and degrade gracefully when
  a block is malformed.
- **Untrusted text is data:** the server never executes or follows instructions found in API text. HTML is parsed with `cheerio`
  and reduced to plain text.
- **Bounded output:** tool results are size-limited, so a hostile or broken response cannot flood the client.
- **Polite client:** one request at a time with a pause between requests, retries with backoff only for 429/5xx.
- **HTTP mode:** stateless, request body limit, optional `Host` header allow-list (`ALLOWED_HOSTS`) against DNS rebinding,
  loopback binding by default.

## Running it as a network service

The HTTP mode has **no authentication and no rate limiting**. Every call causes requests to the Parliament's servers. If you expose it
beyond localhost, put a reverse proxy in front that provides TLS, authentication and rate limiting, and set `ALLOWED_HOSTS`.
