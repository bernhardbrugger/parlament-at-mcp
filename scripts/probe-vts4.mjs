// Date filter with the exact format the site uses (UTC with milliseconds), plus the sort option `sort=datedesc`.
const UA = 'parlament-at-mcp probe (+https://github.com/bernhardbrugger/parlament-at-mcp)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function run(label, extra, query, params = '') {
  const body = { searchType: ['all'], searchScope: ['all'], 's.sm.query': query, category: ['Protokolle'], gp_liste: ['XXVIII'], ...extra };
  const res = await fetch(`https://www.parlament.gv.at/Filter/api/filterform/vts/data?FBEZ=VTS_01&page=1&pagesize=20${params}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': UA },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let out = `HTTP ${res.status}`;
  if (res.ok) {
    const j = JSON.parse(text);
    const d = j.rows.map((r) => r.datetime.slice(0, 10));
    out += ` count=${j.count} rows=${d.length} first=${d[0]} last=${d[d.length - 1]} distinct=${[...new Set(d)].sort().join(',').slice(0, 80)}`;
  }
  console.log(label.padEnd(26), out);
  await sleep(1000);
}
await run('no date', {}, 'Staatsbesuch');
await run('June 2025', { date_range: ['2025-06-01T00:00:00.000Z', '2025-06-30T23:59:00.000Z'] }, 'Staatsbesuch');
await run('only from', { date_range: ['2026-01-01T00:00:00.000Z'] }, 'Staatsbesuch');
await run('sort datedesc', {}, 'Klimaschutz', '&sort=datedesc');
await run('sort dateasc', {}, 'Klimaschutz', '&sort=dateasc');
await run('relevance (default)', {}, 'Klimaschutz');
