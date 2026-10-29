// Records a real full-text search answer (first N rows) as a test fixture.
// Usage: node scripts/save-vts-fixture.mjs tests/fixtures/search-x.json 5 '{"searchType":["all"],...}' ['&sort=datedesc']
import fs from 'node:fs';

const [out, rows, bodyJson, extra = ''] = process.argv.slice(2);
const res = await fetch(`https://www.parlament.gv.at/Filter/api/filterform/vts/data?FBEZ=VTS_01&page=1&pagesize=20${extra}`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'user-agent': 'parlament-at-mcp probe (+https://github.com/bernhardbrugger/parlament-at-mcp)',
  },
  body: bodyJson,
});
const j = await res.json();
fs.writeFileSync(out, JSON.stringify({ ...j, rows: j.rows.slice(0, Number(rows)) }));
console.log(`${out}: count=${j.count}, kept ${Math.min(j.rows.length, Number(rows))}`);
