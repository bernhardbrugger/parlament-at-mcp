# Contributing

Thanks for helping! The Parliament's data interface is undocumented and changes without notice, so the project runs on **measured
facts** and **tests built from real responses**. A few rules keep it that way.

## Setup

```bash
git clone https://github.com/bernhardbrugger/parlament-at-mcp.git
cd parlament-at-mcp
npm install
npm run check        # typecheck + lint + format check + all offline tests
```

Node 20 or newer.

## Rules for changes

1. **Measure first.** Before parsing a new list or page, look at a real response (one polite request). Never rely on memory or on an
   AI answer for field names. Save a trimmed real response as a fixture in `tests/fixtures/`.
2. **Test the pyramid.** Parser/formatter unit tests, client tests with a fake `fetch`, and an MCP-level test through the
   in-memory transport in `tests/server.test.ts`. A bug fix starts with a test that fails on the old code.
3. **Check live.** Add the new tool to `scripts/smoke-live.mjs` (`npm run build && npm run smoke:live`) and, if it relies on a new list
   or page shape, to `tests/integration/drift.test.ts` (`npm run test:integration`). Fixtures cannot show `null` fields, HTML entities
   or shorter real data.
4. **Write down surprises** in `DECISIONS.md`: what was measured, when.
5. **Be polite.** Keep at least one second between requests; tests must not use the network (except the two live suites above,
   which stay small).
6. **Outputs** are German, citable (always include the source URL) and size-bounded. Code, docs and commits are English.
7. **Validate** everything that ends up in a URL; keep the host allow-list.
8. **Scope:** office holders and officials as published by the Parliament. No profiling of private persons, no legal or political advice.

## Commits and pull requests

Small commits with conventional prefixes (`feat:`, `fix:`, `docs:`, `test:`, `chore:`). Describe the problem you solved, not only the change.
`npm run check` must pass. Please open an issue first for larger features.

## Code style

TypeScript strict mode, ESLint (`npm run lint`), Prettier (`npm run format`). `console.log` is forbidden because stdout carries the
MCP protocol on stdio; use `console.error`.
