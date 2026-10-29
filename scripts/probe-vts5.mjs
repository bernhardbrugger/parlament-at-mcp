// Which instants does the date filter include? Session 30 (16.06.2025) is stored as 2025-06-15T22:00:00Z.
const UA = 'parlament-at-mcp probe (+https://github.com/bernhardbrugger/parlament-at-mcp)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function run(label, range) {
  const body = {
    searchType: ['all'],
    searchScope: ['all'],
    's.sm.query': 'Staatsbesuch',
    category: ['Protokolle'],
    gp_liste: ['XXVIII'],
    date_range: range,
  };
  const res = await fetch('https://www.parlament.gv.at/Filter/api/filterform/vts/data?FBEZ=VTS_01&page=1&pagesize=50', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': UA },
    body: JSON.stringify(body),
  });
  const j = res.ok ? await res.json() : null;
  console.log(label.padEnd(44), res.status, j ? `count=${j.count} ${[...new Set(j.rows.map((r) => r.datetime))].join(',')}` : '');
  await sleep(1000);
}
await run('UTC day 16.06 (00:00Z-23:59Z)', ['2025-06-16T00:00:00.000Z', '2025-06-16T23:59:00.000Z']);
await run('UTC day 15.06 (00:00Z-23:59Z)', ['2025-06-15T00:00:00.000Z', '2025-06-15T23:59:00.000Z']);
await run('Vienna day 16.06 (15.06 22:00Z-16.06 21:59Z)', ['2025-06-15T22:00:00.000Z', '2025-06-16T21:59:00.000Z']);
await run('exact instant 15.06 22:00Z both bounds', ['2025-06-15T22:00:00.000Z', '2025-06-15T22:00:00.000Z']);
await run('one second window around it', ['2025-06-15T21:59:59.000Z', '2025-06-15T22:00:01.000Z']);
