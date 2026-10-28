# SPEC — parlament-at-mcp

## Goal
An MCP server for the Austrian Parliament (Nationalrat, Bundesrat) that becomes as good as [ris-mcp-ts](https://github.com/honeyfield-org/ris-mcp-ts) is for the RIS: robust client, validated data, tools written for LLMs, citable results, a large offline test suite, documented API quirks, CI and a registry release.

## Problem
Journalists, researchers and developers who ask an LLM about Austrian politics ("Who sits in committee X?", "What did the FPÖ ask about the budget in 2025?", "Where is bill Y in the process?") get guesses. The data is public and CC BY 4.0, but the only interface is the website's internal JSON filter API: no public endpoint documentation, positional rows, HTML inside text fields and server errors for slightly wrong requests. Nobody has packaged it for LLMs (GitHub search 2026-10-28: no Austrian parliament MCP; the Swiss `malkreide/parlament-mcp` is the nearest design reference).

## What the research found (2026-10-28): claims in the original idea vs. reality
| Claim | Reality |
|---|---|
| "Well-documented REST API at data.parlament.gv.at" | The official open-data page names 25 datasets and a "JSON API based on the web interface" (since Jan 2023) but **documents no endpoints**. Working endpoints come from reverse engineering, helped by the R package [ParlAT](https://github.com/werkstattcodes/ParlAT): `GET /Filter/api/filter/data/{listId}` and `POST /Filter/api/json/post?FBEZ=...` on `www.parlament.gv.at`. Treat as fragile; the Parliament said better docs are planned. |
| "No API key needed" | True. Licence **CC BY 4.0** (attribution: Parlamentsdirektion). |
| "Persons: full profiles" | `GET .../filter/data/10400` returns all 3,273 persons ever (verified, 680 KB, one request). Only name, function, bodies, gender, portrait; richer profile data lives on detail pages (to investigate). |
| "Inquiries and answers as JSON" | `POST ...FBEZ=WFP_005` works (verified: Nationalrat, GP XXVIII gives 7,562 hits). **Every body value must be an array** (a plain string gives HTTP 500). Queries above ~10,000 hits fail (per ParlAT docs), so they must be split. |
| "Plenary protocols already split by speaker as structured JSON" | **Verified, with a catch (M2 research).** A session detail page (`/gegenstand/{GP}/NRSITZ/{n}?json=TRUE`) lists every agenda item (TOP) with time stamps, and every TOP lists its speeches (`speeches[]`: speaker "Herbert Kickl (FPÖ)", time, id). **Each speech has its own HTML segment** (`/dokument/{GP}/NRSITZ/{n}/A_-_HH_MM_SS_{id}.html`, about 21,000 characters for an 11-minute speech), while a whole TOP segment can be 270,000 characters. The text is HTML (speaker, RN markers, applause and interjections in italics), not JSON. So the tools return one speech at a time and mark the interjections. |
| "Premium SaaS with vector search" | Out of scope until the free server is excellent. Parked. |

## Tools (target)
| Tool | Status | Notes |
|---|---|---|
| `parl_abgeordnete` | **done (M1)** | name/body/function search over the cached persons list |
| `parl_anfragen` | **done (M2)** | inquiries or answers (separate queries), body, legislative period, search in the subject, paging across the 50-row pages |
| `parl_gegenstand` | **done (M2)** for inquiries/answers | who asked/answered (with party), stages, PDFs, references, topics. Bills, Anträge, Volksbegehren use the same JSON twin: verify and add in M3 |
| process status | M3 | where is a bill (Ausschuss, Plenum, Bundesrat) |
| `parl_sitzungen`, `parl_sitzung`, `parl_rede` | M3 | session list (list endpoint still to find), session outline with TOPs and speakers, one speech as text with interjections marked, size-budgeted |
| `parl_ausschuesse` | M3 | committees and members |

## Quality bar (what "as good as ris-mcp-ts" means, measured from that repo)
- [x] Zod-validated client with retries, timeouts, throttling, host allowlist
- [x] Offline tests with real-data fixtures; MCP-level tests through an in-memory transport
- [ ] 300+ tests, coverage report; integration suite against the live API kept separate
- [ ] `DECISIONS.md` documenting every measured API quirk (started), `SECURITY.md`, `CONTRIBUTING.md`
- [ ] CI (Linux + Windows, Node 20/22), CodeQL, lint + format, commit hooks (CI file prepared in `ci/`, needs the `workflow` token scope)
- [ ] Response-size budget per tool (clients drop large tool results; ris-mcp-ts measured 45,000 chars for Claude Code)
- [ ] Remote HTTP transport + Dockerfile; MCP registry release (`server.json`); versioned releases
- [ ] README in English with German terms, example prompts, honest limits, attribution line

## Non-goals (for now)
Semantic/vector search, hosted/paid tier, legal or political advice, any de-anonymising or profiling of private persons (only office holders and officials as published by the Parliament).

## Success metric
Registry-published v1.0 with tools M1–M3, 300+ tests, 50 stars or 3 external users/issues within 14 days of the public launch.

## Milestones (incubation deadline 2026-11-18)
- **M1 · 2026-10-28 · done:** client, persons tool, MCP wiring, 23 tests, verified live over stdio.
- **M2 · 2026-11-04 · done 2026-10-28:** `parl_anfragen` (paging over 50-row pages), `parl_gegenstand` (detail JSON), protocol research (speech-level segments exist), real-data fixtures, 74 tests, verified live.
- **M3 · 2026-11-11:** `parl_sitzung` + `parl_rede` (fixtures `session-nr-xxviii-30.json` and a real speech segment are in `tests/fixtures`), find the session-list endpoint, Bundesrat sessions (`/gegenstand/BR/BRSITZ/{n}`), bills/Anträge in `parl_gegenstand`, committees, response-size budget (45,000 characters).
- **M4 · 2026-11-18:** quality-bar items above, launch kit in `drafts/parlament-at-mcp/`, `LAUNCH` item in the inbox.
