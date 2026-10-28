# Decisions and measured API behaviour

Each entry: what was measured or decided, when, and why. Add to it whenever the API surprises you.

## 2026-10-28 · Interface

- The Parliament documents no endpoints. Used: `GET https://www.parlament.gv.at/Filter/api/filter/data/{listId}?js=eval&showAll=true` and `POST https://www.parlament.gv.at/Filter/api/json/post?jsMode=EVAL&FBEZ={code}&pageNumber={n}` (see "Inquiries list" below for paging). Found via the R package ParlAT; verified live.
- List 10400 = all persons ever (3,273 rows, one response). FBEZ `WFP_005` = inquiries and answers.
- Both return `{pages, count, lastSync, header[], rows[][]}`: **rows are positional**, a column's index is `header.rnr - 1`. `rowsToObjects` maps them by label and suffixes repeated labels.
- `POST` bodies need **array values** (`{"GP":["XXVIII"]}`). A plain string (`"GP":"XXVIII"`, or `"SUCH":"Budget"`) gives HTTP 500 with an HTML error page.
- Text fields contain HTML (`Mag.<sup>a</sup>` for the academic title "Mag.a"); `cleanText` keeps the text and drops tags.
- The `persart` column is a JSON string with a repeated body code per term of office (`["BR","BR","MPO"]`); we de-duplicate. Codes seen: NR, BR, BuREG, KN, PN, MPO, PD, VA, MEP, LH, PRRH, BP.
- Nothing in the list says who is _currently_ in office; `funktion` is the only hint. The tool description says so openly.

## 2026-10-28 · Inquiries list (FBEZ WFP_005), measured

- **Paging:** 50 rows per page via `pageNumber=N` (starting at 1). A page past the end returns 200 with zero rows. `rowsPerPage` is not accepted (HTTP 500). `showAll=true` returns everything in one response: 6.8 MB for the 7,562 inquiries of the XXVIII. GP. The client therefore pages and only uses `all` for small result sets.
- **Order:** newest first by default.
- **Search:** `SUCH` is matched against the subject ("Betreff"); the value must be an array. An answer's subject repeats the inquiry's subject plus "zu 6817/J".
- **Type filter `JMAB`:** `J_JPR_M` = written inquiries, `AB_ABPR_ABM` = answers. The server **cannot combine both**: two values, or no value, return inquiries only. `parl_anfragen` takes one type per call.
- **Count cap:** without a legislative period the reported count stops at 20,004 (same number with and without type filter), so it is a lower bound. The tool says so and asks to narrow with `gp` or `suche`.
- **Header quirk:** the two `link` columns have **no `rnr`**; positions fall back to the index in the header array. The list does not say who asked: that is on the detail page.
- Cells contain HTML: the type is `<span title="Schriftliche Anfrage">J</span>`, the status a `<div class="status" title="...">`. We read the `title` attributes.

## 2026-10-28 · Detail pages ("JSON twin")

- Append `?json=TRUE` to a page path: `/gegenstand/XXVIII/J/7436?json=TRUE` (inquiry), `.../AB/6209` (answer). Unknown items answer HTTP 404.
- `content` has `type, title, zitation, description, einlangen, stages[], documents[], names[]` (`funktext` "Eingebracht von" / "Eingebracht an" / "Beantwortet durch", `name`, `frak_code` = party letter, `ltext` = ministry, `url`). Answers also have `reference[]`, `topics`, `headwords`, `eurovoc` (`rendertype: bubbles`).
- The path is built from a validated legislative period and citation only; nothing the caller types reaches the URL.

## 2026-10-28 · Plenary sessions and speeches (research; implemented in M3)

- Session JSON: `/gegenstand/{GP}/NRSITZ/{n}?json=TRUE` (Bundesrat: `/gegenstand/BR/BRSITZ/{n}`). Unlike other detail pages, `content` is an **array of three blocks**: [0] metadata including `stdocuments` (full protocol PDF/HTML), [1] `info` (start/end), [2] `progress[]` = agenda items with time and, for debates, `speeches[]`.
- A speech entry has `texta` = "Herbert Kickl (FPÖ)", `time`, `st_objekte_id`, `protocol.data.links[].documents[]` = HTML and PDF of **that speech only**, `autorisiert`, `veroeffentlicht`.
- Segment HTML: `<p class="randnummer" title="Speaker (Party)">RN/23</p>`, `_RB`/`_RE` = start/end time, the speaker links to `/person/{id}`, interjections are in `<i>`. One 11-minute speech is about 21,000 characters, a whole TOP segment about 270,000. Always fetch per speech.
- Newer protocols carry a note (`sthint`) that the raw transcript was produced with AI support and then edited. Tools should pass that note on.

## 2026-10-28 · Numbered lists: sessions (701) and items (101), measured

- Besides `POST /Filter/api/json/post?FBEZ=...` there is `POST /Filter/api/filter/data/{listId}?page=N&pagesize=50` (found via ParlAT). Body values are arrays here too. Paging works with `page` and `pagesize` (50 accepted); a short page is the last one.
- **Sessions, list 701:** body `{"GREMIUM":["NR"],"GP_CODE":["XXVIII"],"SIAKT":["SI"]}`; `sortrnr=22&ascDesc=DESC` gives newest first. 104 sessions in the XXVIII. GP at the time of measuring. For the Bundesrat omit `GP_CODE`: 1,207 sessions, numbered continuously (997 in October 2026), path `/gegenstand/BR/BRSITZ/{n}`.
- Most columns of list 701 have **no label** (hidden); the useful ones sit at fixed positions (Datum 20, Betreff 22, session link 28, kind text 25). They are exposed as `col{index}`. Header labels are therefore optional in the schema.
- **Items, list 101:** body `{"NRBR":["NR"],"GP_CODE":["XXVIII"],"VHG":["RV"]}`. Verified `VHG` values: `RV` (Regierungsvorlage, 128 in the XXVIII. GP), `ANTR` (Anträge, 1,606), `VOLKBG` (Volksbegehren, 5). `SW` filters by the official keyword (exact vocabulary, not full text): "Verwaltungsverfahren" finds 2 bills. A single `DATUM_VON` value is ignored (ParlAT sends two values: from and to; not verified here).
- Item rows carry `ITYP` + `INR` (citation "251/I"), a link in `HIS_URL`, the vote as text in `Abstimmungstext` and JSON-encoded strings for `THEMEN`/`SW`.

## 2026-10-28 · Detail JSON of bills (RV)

- `/gegenstand/XXVIII/I/251?json=TRUE`: no `stages`; instead `status` (phase number, HTML description, `bgbllinks` to the Bundesgesetzblatt), `phase[]` (named phases such as "Einlangen NR", "Ausschussberatungen NR", "Plenarberatungen NR", "Einlangen BR" ... with dated `stages[]`), `shortinfo` (HTML bullet lists), `vote` (text and per-party result), `correspondence` (press releases).
- **Fields are often `null`**, not absent: ministers have `frak_code: null`. The schema uses `nullish()` for the whole detail block; a strict `optional()` made the live call fail.
- Text contains HTML entities (`Erm&auml;chtigung`); `cleanText` decodes numeric and the common named entities.

## 2026-10-28 · Speeches in tools (implemented)

- `parl_sitzung` finds the three content blocks by their keys, not by position. It lists every speaker only for sessions with at most 40 speeches or when `top`/`redner` narrows it down; the real 30th session has 100 speeches in 13 agenda items.
- `parl_rede` locates a speech by `st_objekte_id` in the cached session JSON (10 minutes), then fetches only that speech's HTML segment. The document path must match `/dokument/{GP|BR}/{NRSITZ|BRSITZ}/{n}/{name}.html`; nothing else is ever requested.
- Interjections are in `<i>` and are kept by default (they are part of the record); `zwischenrufe=false` removes them.
- Output windows end at a paragraph break when one is close, and the reply says where to continue (`offset`).

## 2026-10-28 · Column positions: use the header index, not `rnr`

- The list of current Nationalrat members (`WFW_002`) numbers its columns `rnr` 1, 2, 4, 5, ... (3 is missing). `rnr - 1` shifted Wahlkreis and Bundesland by one column ("Wahlkreis W · Disoski"). Rows are aligned with the **array position** of the header entries; `rowsToObjects` uses that whenever header and row length agree and falls back to `rnr - 1` only otherwise. Found by a live run, not by the fixture tests.

## 2026-10-28 · Current members, committees, persons (M4), measured

- **Current members:** `POST /Filter/api/json/post?jsMode=EVAL&FBEZ=WFW_002&showAll=true` (Nationalrat, 183 rows) and `FBEZ=WFW_005` (Bundesrat, 60 rows). Body must select a gender: `{"M":["M"],"W":["W"]}`; an empty body answers `{"errorMsg":"Fehler: Mann und/oder Frau muss ausgewählt sein!"}` with HTTP 200. Nationalrat rows carry the id only in the `/person/{id}` link, Bundesrat rows in the `pad_intern` column. The club is a `<span title="full name">ABBR</span>`, the Bundesland of an Nationalrat member a span whose `title` is the full name. The persons list (10400) cannot say who is in office; this is how `aktuell` is derived. Cached for one hour.
- **Committees:** `FBEZ=WFP_009`, body `{"NRBR":["NR"],"GP":["XXVIII"]}`, `showAll=true` (38 committees, Pilnacek-Untersuchungsausschuss included). Bundesrat committees work without `GP`. Detail page `/ausschuss/{GP}/{CODE}/{n}/{id}?json=TRUE` (path from the `link` column): `names` = Obmann / Obmannstellvertreter(in) with `url`, `description`, `recentagenda` (latest agendas with PDF/HTML), `assignments.data.links` (items assigned to the committee). `phase` entries of committees have no `name` (the strict schema failed on this; found live).
- **Person page:** `/person/{pad_intern}?json=TRUE` → `content.personInfo.aktiv`, `content.biografie.mandatefunktionen.mandate[]` (`bez`, `zeitraum`, `aktiv`, `klub`, `wahlkreis`), `kurzbiografie` (`gebtext`, `beruflicherWerdegang[]`, `bildungsweg[]`, `politischeFunktionen[]`), `biografieStand`. The page also embeds filter definitions for the person's speeches (list 251), committees (250) and activities (25).
- **Speeches of a person, list 251:** `POST /Filter/api/filter/data/251?page=1&pagesize=50&sortrnr=10&ascDesc=DESC`, body `{"PAD_INTERN":["91034"]}` (string or number both work): 129 speeches for Rendi-Wagner. Columns: Sitzung (HTML link `/sitzung/XXVII/NRSITZ/217`), Rede (topic), protocol link with anchor `#RU_297804`, `fromDate`. The list has **no `st_objekte_id`**; the tool therefore points to `parl_sitzung` with `redner=` to get the number `parl_rede` needs.

## 2026-10-28 · Lenient detail schema

- Optional structured blocks of detail pages (`names`, `documents`, `stages`, `status`, `phase`, `vote`, `topics`, `recentagenda`, ...) are wrapped in `lenient()` = `nullish().catch(undefined)`: if the Parliament changes the shape of one block, that section is omitted and the rest of the page still works. Scalar fields are `nullish()` because the API sends `null` freely. A test feeds malformed blocks to prove it.

## 2026-10-28 · Decisions of a session (`resolutions`), measured (v0.5)

- The metadata block of a session page (`content[0]`) carries `resolutions[]`: one entry per agenda item with `top` ("TOP 3"), `text`, `zitation`, `url` and `materials[]`; each material has `stages[]` (dated, HTML) that contain the **committee decision, the plenary decision of this session ("30. Sitzung des Nationalrates: Gesetzesvorschlag in dritter Lesung angenommen<br>Dafür: ÖVP, SPÖ, NEOS, dagegen: FPÖ, GRÜNE") and later steps** (e.g. "979. Sitzung: Antrag, keinen Einspruch zu erheben, angenommen" = Bundesrat).
- Several materials of one item repeat the same stage; `parl_beschluesse` de-duplicates by date + text. The plenary stage is recognised by "{n}. Sitzung des Nationalrat|Bundesrat" with a non-digit before `n` (so 3 does not match 103); stages with a later date that name a "Sitzung" (and are not committee stages) are shown as "danach".
- Also in that block: `correspondence[]` (press releases of the Parlamentskorrespondenz with date and link) and `agenda[]` (Tagesordnung PDF/HTML, Fragestunde, list of motions). Future sessions do not exist in the system: `/gegenstand/XXVIII/NRSITZ/105` was a 404 when 104 was the latest, so "the agenda of the next session" is only available once the Parliament publishes the session.
- **Volksbegehren** (`VHG=VOLKBG`, 5 in the XXVIII. GP) are ordinary items (`4 d.B.`, path `/gegenstand/XXVIII/I/4`) with status, phases and short info; the JSON has **no signature numbers**.
- Lists not understood yet: `WFW_003` and `WFW_006` answer with 0 rows for an empty-gender body (probably need a function/term filter), `WFW_004` (2,046 rows, "Gesetzgebungsperioden") and `WFW_007` (1,059 rows, Bundesrat) look like all members ever. A list of the current government was not found; `parl_abgeordnete` with `gremium=BuREG` and `funktion` is the fallback.

## 2026-10-28 · Client behaviour

- Default pause of 1 s between requests and a single request at a time: the Parliament publishes no rate limit, so be polite. Retries on 429/5xx/network errors with exponential backoff; never on other 4xx.
- The client refuses any host except `www.parlament.gv.at`, so a configuration mistake cannot turn it into an open proxy.
- Big lists are cached for 6 hours in memory (they change at most daily; `lastSync` shows the server-side time).

## 2026-10-28 · Language

- Tool descriptions and output are German: the users, the data and the legal terms are Austrian. Code, docs and commit messages are English.

## 2026-10-28 · Scope

- Only office holders and officials as published by the Parliament. No enrichment, no profiling of private persons.

## 2026-10-28 · More kinds of items in list 101, and its sort order (v0.5)

- `VHG` values measured for the XXVIII. GP (Nationalrat): `PET` Petitionen (29), `BI` Bürgerinitiativen (36), `EU` EU documents (6,928, many sub-types such as `EUBTG` = reports on sessions of preparatory bodies). `ME`, `STV`, `BRM`, `UEA`, `ENTSCH`, `VBG`, `SN` answer with 0 rows: they are not valid values (Ministerialentwürfe live elsewhere).
- **The list has no useful default order.** Without a sort it returned `251/I` (2025-10-15) first although `657/I` (2026-10-14) exists; the same for petitions and EU documents. `sortrnr=9&ascDesc=DESC` (column 9 = `DATUMSORT`) gives newest first. `parl_gegenstaende` claimed "neueste zuerst" before without asking for it: fixed in this version. The inquiries list (`WFP_005`) is already newest first; the speeches list is sorted explicitly. Items of the same day come in no stable order.
- The detail pages of petitions and citizens' initiatives have the same shape as bills: `names` (petition handed in by an MP, or the first signatory of an initiative), `status`, `phase` (Einlangen, Ausschuss für Petitionen und Bürgerinitiativen, Plenum), `documents`, `correspondence` (press releases, now shown). **No number of supporters** is in the JSON; the electronic-support form (`approvals`) only carries the form definition.
- Not found, so not built: a list of the current federal government (see the 2026-10-28 session notes above), voting by individual member (the plenary decision carries party votes only), and a full-text search across everything.
