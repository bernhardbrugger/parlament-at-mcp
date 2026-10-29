// Probes the Parliament's full-text search (VTS_01). One request per second.
//   node scripts/probe-vts.mjs form                      -> options of the search form
//   node scripts/probe-vts.mjs search "query" [type] [scope] [--save file] [--page n]
const UA = 'parlament-at-mcp probe (+https://github.com/bernhardbrugger/parlament-at-mcp)';
const BASE = 'https://www.parlament.gv.at/Filter/api/filterform/vts';
const args = process.argv.slice(2);

async function post(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': UA },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, text };
}

if (args[0] === 'form') {
  const { status, text } = await post(`${BASE}/form?FBEZ=VTS_01`, { searchType: ['all'], searchScope: ['all'] });
  console.log(status, text.length);
  console.log(text.slice(0, 6000));
} else if (args[0] === 'search') {
  const saveAt = args.indexOf('--save');
  const save = saveAt >= 0 ? args[saveAt + 1] : null;
  const pageAt = args.indexOf('--page');
  const page = pageAt >= 0 ? Number(args[pageAt + 1]) : 1;
  const positional = args
    .slice(1)
    .filter((a, i, all) => !a.startsWith('--') && all[i - 1] !== '--save' && all[i - 1] !== '--page' && all[i - 1] !== '--filters');
  const [query, type = 'all', scope = 'all'] = positional;
  const fAt = args.indexOf('--filters');
  const filters = fAt >= 0 ? JSON.parse(args[fAt + 1]) : {};
  const body = { searchType: [type], searchScope: [scope], 's.sm.query': query, ...filters };
  const { status, text } = await post(`${BASE}/data?FBEZ=VTS_01&page=${page}&pagesize=20`, body);
  console.log('HTTP', status, 'bytes', text.length, 'body', JSON.stringify(body));
  if (save) (await import('node:fs')).writeFileSync(save, text);
  try {
    const j = JSON.parse(text);
    console.log('count', j.count, 'pages', j.pages, 'navigators', JSON.stringify(j.navigators).slice(0, 800));
    const by = {};
    for (const r of j.rows) {
      const k = `${r.label} | ${r.item_type ?? '-'} | ${(r.category ?? []).join('/')}`;
      by[k] = (by[k] ?? 0) + 1;
    }
    console.log(by);
    for (const r of j.rows.slice(0, 8))
      console.log('-', r.label, '|', r.link, '|', (r.title ?? '').slice(0, 80), '|', r.datetime?.slice(0, 10));
  } catch {
    console.log(text.slice(0, 500));
  }
}
