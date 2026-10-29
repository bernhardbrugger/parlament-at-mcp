// Date filter format of the full-text search: tries spellings until one is accepted and narrows the hits.
const UA = 'parlament-at-mcp probe (+https://github.com/bernhardbrugger/parlament-at-mcp)';
const URL_BASE = 'https://www.parlament.gv.at/Filter/api/filterform/vts/data?FBEZ=VTS_01&page=1&pagesize=20';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const variants = {
  'single "DE - DE"': ['01.06.2025 - 30.06.2025'],
  'single "DE-DE"': ['01.06.2025-30.06.2025'],
  'single "ISO,ISO"': ['2025-06-01,2025-06-30'],
  'single "DE,DE"': ['01.06.2025,30.06.2025'],
  'single "ISO - ISO"': ['2025-06-01 - 2025-06-30'],
  'string DE - DE': '01.06.2025 - 30.06.2025',
  'ISO T array': ['2025-06-01T00:00:00', '2025-06-30T23:59:59'],
  'epoch-ms array': [String(Date.UTC(2025, 5, 1)), String(Date.UTC(2025, 5, 30))],
};
for (const [label, value] of Object.entries(variants)) {
  const body = {
    searchType: ['all'],
    searchScope: ['all'],
    's.sm.query': 'Staatsbesuch',
    category: ['Protokolle'],
    gp_liste: ['XXVIII'],
    date_range: value,
  };
  const res = await fetch(URL_BASE, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': UA },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let out = `HTTP ${res.status}`;
  if (res.ok) {
    const j = JSON.parse(text);
    out += ` count=${j.count} dates=${[...new Set(j.rows.map((r) => r.datetime.slice(0, 10)))].sort().join(',')}`;
  }
  console.log(label.padEnd(22), out);
  await sleep(1000);
}
