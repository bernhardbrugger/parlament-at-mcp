# parlament-at-mcp

MCP server for the **Austrian Parliament** (Nationalrat, Bundesrat). Ask an LLM who sits where, what was asked and answered, and where a bill stands - with a link to the official source for every result.

> **Status: early (v0.1).** One tool works today; the rest is on the roadmap in [`SPEC.md`](SPEC.md). Unofficial; not affiliated with the Parlamentsdirektion.

## Tools

| Tool | What it does | Status |
|---|---|---|
| `parl_abgeordnete` | Find people who sat in the Parliament (Nationalrat, Bundesrat, Bundesregierung, ...) by name, body and function | ✅ |
| `parl_anfragen` | Parliamentary inquiries and answers | planned (M2) |
| `parl_gegenstand` | Details and stages of a bill / motion / petition | planned (M2) |
| `parl_sitzungen`, `parl_protokolle` | Plenary sessions and protocol text in citable chunks | planned (M3) |
| `parl_ausschuesse` | Committees and their members | planned (M3) |

Example prompts: *"Wer war Bundesministerin und Abgeordnete zum Nationalrat und heißt Rendi-Wagner?"*, *"Zeig mir alle Volksanwälte im Parlamentsverzeichnis."*

## Install and run

```bash
git clone https://github.com/bernhardbrugger/parlament-at-mcp.git
cd parlament-at-mcp
npm install && npm run build
```

Claude Desktop / any MCP client (stdio):

```json
{ "mcpServers": { "parlament-at": { "command": "node", "args": ["/absolute/path/to/parlament-at-mcp/dist/index.js"] } } }
```

## Data, licence, limits

- Source: open data of the Austrian Parliament, **CC BY 4.0**, attribution: *Parlamentsdirektion*. See the [Parliament's open data page](https://www.parlament.gv.at/recherchieren/open-data/).
- The server uses the website's JSON interface, which is **not formally documented** and may change. What we measured is recorded in [`DECISIONS.md`](DECISIONS.md).
- The client waits 1 second between requests and caches large lists for 6 hours.
- Results are official information, not legal or political advice.

## Development

```bash
npm test          # offline tests (real-data fixtures, MCP-level tests through an in-memory transport)
npm run check     # typecheck + tests
```

A GitHub Actions workflow is prepared in `ci/github-actions-ci.yml`.

## License
MIT - see [LICENSE](LICENSE). Data: CC BY 4.0 (Parlamentsdirektion).
