# Decisions and measured API behaviour

Each entry: what was measured or decided, when, and why. Add to it whenever the API surprises you.

## 2026-10-28 · Interface
- The Parliament documents no endpoints. Used: `GET https://www.parlament.gv.at/Filter/api/filter/data/{listId}?js=eval&showAll=true` and `POST https://www.parlament.gv.at/Filter/api/json/post?jsMode=EVAL&FBEZ={code}&showAll=true`. Found via the R package ParlAT; verified live.
- List 10400 = all persons ever (3,273 rows, one response). FBEZ `WFP_005` = inquiries and answers.
- Both return `{pages, count, lastSync, header[], rows[][]}`: **rows are positional**, a column's index is `header.rnr - 1`. `rowsToObjects` maps them by label and suffixes repeated labels.
- `POST` bodies need **array values** (`{"GP":["XXVIII"]}`). A plain string (`"GP":"XXVIII"`, or `"SUCH":"Budget"`) gives HTTP 500 with an HTML error page.
- Text fields contain HTML (`Mag.<sup>a</sup>` for the academic title "Mag.a"); `cleanText` keeps the text and drops tags.
- The `persart` column is a JSON string with a repeated body code per term of office (`["BR","BR","MPO"]`); we de-duplicate. Codes seen: NR, BR, BuREG, KN, PN, MPO, PD, VA, MEP, LH, PRRH, BP.
- Nothing in the list says who is *currently* in office; `funktion` is the only hint. The tool description says so openly.

## 2026-10-28 · Client behaviour
- Default pause of 1 s between requests and a single request at a time: the Parliament publishes no rate limit, so be polite. Retries on 429/5xx/network errors with exponential backoff; never on other 4xx.
- The client refuses any host except `www.parlament.gv.at`, so a configuration mistake cannot turn it into an open proxy.
- Big lists are cached for 6 hours in memory (they change at most daily; `lastSync` shows the server-side time).

## 2026-10-28 · Language
- Tool descriptions and output are German: the users, the data and the legal terms are Austrian. Code, docs and commit messages are English.

## 2026-10-28 · Scope
- Only office holders and officials as published by the Parliament. No enrichment, no profiling of private persons.
