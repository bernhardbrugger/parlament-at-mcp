# Changelog

## 0.5.0 (unreleased)

- **New tool `parl_beschluesse`:** what a plenary session decided per agenda item, with the vote by party, later steps (e.g. Bundesrat), press releases and agenda links.
- CI on Linux and Windows (Node 20/22), Dependabot; ESLint 10, cheerio 1.2. Vitest stays on 2.x because Vitest 5 requires Node 22+.
- LF line endings everywhere (`.gitattributes`): Windows runners used to check files out with CRLF and failed the format check.

## 0.4.0

- **New tools:** `parl_ausschuesse` (committees; with `suche=` also chairs, tasks, latest agendas, assigned items), `parl_person` (biography and mandates),
  `parl_reden_person` (all plenary speeches of a person).
- **`parl_abgeordnete`:** current members of the Nationalrat and Bundesrat are marked (club, constituency, state) and filterable (`nur_aktuell`, `klub`, `bundesland`).
- **Structured output:** the list tools return `structuredContent` with an `outputSchema` next to the text.
- **Prompts:** five research workflows (`rede_recherchieren`, `gesetz_verfolgen`, `anfragen_zum_thema`, `ausschuss_ueberblick`, `abgeordnete_profil`).
- **HTTP mode:** stateless Streamable-HTTP endpoint (`npm run start:http`), `/healthz`, Host-header allow-list, body limit; Dockerfile.
- **Robustness:** optional blocks of detail pages are lenient (a changed block is omitted, the rest still works); a live canary suite
  (`npm run test:integration`) checks that every list and page still has the columns the parsers read.
- **Fix:** column positions come from the header index, not from `rnr` (the member list skips a number and shifted two columns).
- **Quality:** ESLint, Prettier, coverage (`npm run test:coverage`), `SECURITY.md`, `CONTRIBUTING.md`, issue and PR templates, `server.json`.

## 0.3.0

- `parl_sitzungen`, `parl_sitzung`, `parl_rede` (single speeches from the protocol), `parl_gegenstaende`; procedure, vote and Bundesgesetzblatt in `parl_gegenstand`.

## 0.2.0

- `parl_anfragen`, `parl_gegenstand`; paging over the Parliament's 50-row pages.

## 0.1.0

- Client, `parl_abgeordnete`, MCP wiring.
