// Second round of measurements on the full-text search: date filter formats, page size, sorting, deep paging.
const UA = 'parlament-at-mcp probe (+https://github.com/bernhardbrugger/parlament-at-mcp)';
const URL_BASE = 'https://www.parlament.gv.at/Filter/api/filterform/vts/data?FBEZ=VTS_01';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run(label, extraBody, query = 'Staatsbesuch', params = '&page=1&pagesize=20') {
  const body = {
    searchType: ['all'],
    searchScope: ['all'],
    's.sm.query': query,
    category: ['Protokolle'],
    gp_liste: ['XXVIII'],
    ...extraBody,
  };
  const res = await fetch(URL_BASE + params, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': UA },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let out = `HTTP ${res.status}`;
  try {
    const j = JSON.parse(text);
    const dates = j.rows.map((r) => r.datetime?.slice(0, 10));
    out += ` count=${j.count} rows=${j.rows.length} first=${dates[0]} last=${dates[dates.length - 1]} range=${[...new Set(dates)].sort().slice(0, 3).join(',')}${dates.length > 3 ? '…' : ''}`;
  } catch {
    out += ` ${text.slice(0, 120)}`;
  }
  console.log(`${label.padEnd(34)} ${out}`);
  await sleep(1000);
}

await run('baseline', {});
await run('date_range ISO array', { date_range: ['2025-06-01', '2025-06-30'] });
await run('date_range DE array', { date_range: ['01.06.2025', '30.06.2025'] });
await run('date_range object', { date_range: { from: '2025-06-01', to: '2025-06-30' } });
await run('date_range.from/.to', { 'date_range.from': '01.06.2025', 'date_range.to': '30.06.2025' });
await run('date_range von/bis', { 'date_range.von': '01.06.2025', 'date_range.bis': '30.06.2025' });
await run('pagesize 50', {}, 'Staatsbesuch', '&page=1&pagesize=50');
await run('pagesize 100', {}, 'Klimaschutz', '&page=1&pagesize=100');
await run('sortrnr=1 DESC', {}, 'Klimaschutz', '&page=1&pagesize=20&sortrnr=1&ascDesc=DESC');
await run('sort=datetime desc', { sort: ['datetime'], ascDesc: ['desc'] }, 'Klimaschutz');
await run('page 500 (deep)', {}, 'Klimaschutz', '&page=215&pagesize=20');
await run('page 600 (past end)', {}, 'Klimaschutz', '&page=600&pagesize=20');
