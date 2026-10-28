# Decisions and measured API behaviour

Each entry: what was measured or decided, when, and why. Add to it whenever the API surprises you.

## 2026-10-28 · Interface
- The Parliament documents no endpoints. Used: `GET https://www.parlament.gv.at/Filter/api/filter/data/{listId}?js=eval&showAll=true` and `POST https://www.parlament.gv.at/Filter/api/json/post?jsMode=EVAL&FBEZ={code}&pageNumber={n}` (see "Inquiries list" below for paging). Found via the R package ParlAT; verified live.
- List 10400 = all persons ever (3,273 rows, one response). FBEZ `WFP_005` = inquiries and answers.
- Both return `{pages, count, lastSync, header[], rows[][]}`: **rows are positional**, a column's index is `header.rnr - 1`. `rowsToObjects` maps them by label and suffixes repeated labels.
- `POST` bodies need **array values** (`{"GP":["XXVIII"]}`). A plain string (`"GP":"XXVIII"`, or `"SUCH":"Budget"`) gives HTTP 500 with an HTML error page.
- Text fields contain HTML (`Mag.<sup>a</sup>` for the academic title "Mag.a"); `cleanText` keeps the text and drops tags.
- The `persart` column is a JSON string with a repeated body code per term of office (`["BR","BR","MPO"]`); we de-duplicate. Codes seen: NR, BR, BuREG, KN, PN, MPO, PD, VA, MEP, LH, PRRH, BP.
- Nothing in the list says who is *currently* in office; `funktion` is the only hint. The tool description says so openly.

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

## 2026-10-28 · Client behaviour
- Default pause of 1 s between requests and a single request at a time: the Parliament publishes no rate limit, so be polite. Retries on 429/5xx/network errors with exponential backoff; never on other 4xx.
- The client refuses any host except `www.parlament.gv.at`, so a configuration mistake cannot turn it into an open proxy.
- Big lists are cached for 6 hours in memory (they change at most daily; `lastSync` shows the server-side time).

## 2026-10-28 · Language
- Tool descriptions and output are German: the users, the data and the legal terms are Austrian. Code, docs and commit messages are English.

## 2026-10-28 · Scope
- Only office holders and officials as published by the Parliament. No enrichment, no profiling of private persons.
