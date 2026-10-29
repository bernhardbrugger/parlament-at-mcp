# Design notes — parlament-at-mcp

## Goal

An MCP server for the Austrian Parliament (Nationalrat, Bundesrat) that gives LLM clients reliable, citable access to speeches, votes, bills, inquiries, committees and members: a robust client, validated data, tools written for LLMs, results that carry their source, a large offline test suite and every API quirk written down. [ris-mcp-ts](https://github.com/honeyfield-org/ris-mcp-ts), the same kind of server for the Austrian legal information system RIS, was the design reference.

## Problem

Journalists, researchers and developers who ask an LLM about Austrian politics ("Who sits in committee X?", "What did the FPÖ ask about the budget in 2025?", "Where is bill Y in the process?", "Did Z really say that?") get guesses. The data is public and CC BY 4.0, but the only interface is the website's own JSON API: no published endpoint documentation, positional rows, HTML inside text fields and server errors for slightly wrong requests. When this project started (2026-10-28) no MCP server for the Austrian Parliament was found on GitHub; the Swiss `malkreide/parlament-mcp` is the nearest design reference.

## Assumptions checked against the live API

| Assumption                               | What was measured                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "There is a documented REST API"         | The Parliament's open-data page names 25 datasets and a "JSON API based on the web interface" (since Jan 2023) but **documents no endpoints**. The working endpoints were found by reverse engineering, helped by the R package [ParlAT](https://github.com/werkstattcodes/ParlAT) and by watching the website's own requests. Treat them as fragile. |
| "No API key needed"                      | True. Licence **CC BY 4.0** (attribution: Parlamentsdirektion).                                                                                                                                                                                                                                                                                       |
| "Persons: full profiles"                 | `GET .../filter/data/10400` returns all persons ever (3,273 when measured, 680 KB, one request) with name, function, bodies, gender and portrait only; richer data lives on the person's detail page.                                                                                                                                                 |
| "Inquiries and answers as JSON"          | `POST ...FBEZ=WFP_005` works. **Every body value must be an array** (a plain string gives HTTP 500). Queries above about 10,000 hits fail, so large result sets are paged.                                                                                                                                                                            |
| "Plenary protocols are split by speaker" | True, as HTML rather than JSON. A session page lists every agenda item with its speeches; **each speech has its own HTML segment** (about 21,000 characters for an 11-minute speech) while a whole agenda item can be 270,000 characters. The tools return one speech at a time and keep interjections optional.                                      |
| "Full-text search over speeches"         | The website's own search indexes the protocol segments (category "Protokolle", about 221,000 documents; the hits of text searches were single speeches) and supports exact phrases, period and date filters. Its person filter does not work for speeches, so the speaker is filtered afterwards. Details in `DECISIONS.md`.                          |

## Tools

| Tool                                                   | What it does                                                                                                                                                          |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `parl_suche`                                           | full-text search over all plenary speeches (also press releases and items): exact phrases, speaker, period, date range; every hit names the arguments for `parl_rede` |
| `parl_rede`                                            | one speech as text, paragraphs numbered, optional interjections, `absaetze` range, 45,000-character budget with `offset` paging                                       |
| `parl_sitzungen`, `parl_sitzung`                       | session list (Nationalrat and Bundesrat); outline of one session with agenda items and every speaker                                                                  |
| `parl_beschluesse`                                     | decisions per agenda item of a session with party votes, later steps, press releases, agenda links                                                                    |
| `parl_gegenstaende`, `parl_gegenstand`                 | list bills, motions, referendums, petitions, citizens' initiatives and EU documents; one item with introducer, procedure per phase, vote, Bundesgesetzblatt, PDFs     |
| `parl_anfragen`                                        | inquiries or answers, paged across the 50-row server pages                                                                                                            |
| `parl_abgeordnete`, `parl_person`, `parl_reden_person` | persons and current members (club, constituency, state), biography and mandates, all plenary speeches of a person                                                     |
| `parl_ausschuesse`                                     | committees by period; chairs, tasks, latest agendas and assigned items on request                                                                                     |

Six prompts chain the tools for common research tasks, among them `faktencheck`, which separates "was it said" from "is it true".

## Quality bar

- [x] Zod-validated client with retries, timeouts, throttling and a host allow-list
- [x] Offline tests with real-data fixtures and MCP-level tests through an in-memory transport (440+ tests, 98 % lines, 88 % branches)
- [x] A live smoke test and a live canary suite against the real API, kept out of `npm test`
- [x] `DECISIONS.md` documenting every measured API quirk, `SECURITY.md`, `CONTRIBUTING.md`, issue and pull-request templates
- [x] CI on Linux and Windows (Node 20 and 22), lint and format checks, Dependabot
- [x] Response-size budget: `parl_rede` pages at 45,000 characters at most, other tools stay below 20,000 (known exception: see `DECISIONS.md`)
- [x] Remote HTTP transport (stateless, opt-in) and `server.json` for the MCP registry
- [ ] Dockerfile built and tested (written, never built)
- [ ] CodeQL (needs a public repository)

## Non-goals

Semantic or vector search, a hosted or paid tier, legal or political advice, and any profiling of private persons (only office holders and officials as published by the Parliament).

## Roadmap

Stable `parlament://` URIs as MCP resources, widgets for result lists (with a text fallback), readable labels for the many EU document types.
