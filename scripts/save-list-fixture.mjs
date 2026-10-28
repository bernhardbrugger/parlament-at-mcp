// Records a real list-101 answer (newest first: sortrnr=9 is DATUMSORT) as a test fixture. Usage: node scripts/save-list-fixture.mjs PET XXVIII 4 tests/fixtures/items-101-pet-xxviii.json
const [vhg, gp, rows, out] = process.argv.slice(2);
import fs from 'node:fs';

const res = await fetch(
  'https://www.parlament.gv.at/Filter/api/filter/data/101?js=eval&showAll=true&page=1&pagesize=50&sortrnr=9&ascDesc=DESC',
  {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'user-agent': 'parlament-at-mcp probe (+https://github.com/bernhardbrugger/parlament-at-mcp)',
    },
    body: JSON.stringify({ NRBR: ['NR'], GP_CODE: [gp], VHG: [vhg] }),
  },
);
const j = await res.json();
const keep = Number(rows);
const trimmed = { ...j, rows: j.rows.slice(0, keep) };
fs.writeFileSync(out, JSON.stringify(trimmed));
console.log(`${vhg}: count=${j.count}, kept ${trimmed.rows.length} rows -> ${out}`);
