// Measures which values of the `VHG` filter (list 101) exist and how many hits each has. One request per second.
const BASE = 'https://www.parlament.gv.at/Filter/api/filter/data/101?js=eval&showAll=true&page=1&pagesize=2';
const codes = process.argv.slice(2);

for (const code of codes) {
  const res = await fetch(BASE, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'user-agent': 'parlament-at-mcp probe (+https://github.com/bernhardbrugger/parlament-at-mcp)',
    },
    body: JSON.stringify({ NRBR: ['NR'], GP_CODE: ['XXVIII'], VHG: [code] }),
  });
  const text = await res.text();
  let summary;
  try {
    const j = JSON.parse(text);
    const h = j.header.map((c) => c.label ?? '-').join('|');
    const first = j.rows?.[0] ? JSON.stringify(j.rows[0]).slice(0, 260) : 'no rows';
    summary = `count=${j.count} header=${h}\n    first: ${first}`;
  } catch {
    summary = `HTTP ${res.status} ${text.slice(0, 100)}`;
  }
  console.log(`${code}: ${summary}`);
  await new Promise((r) => setTimeout(r, 1000));
}
