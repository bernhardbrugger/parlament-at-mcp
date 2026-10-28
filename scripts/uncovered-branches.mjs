// Lists the branches that no test reaches. Usage: npx vitest run --coverage --coverage.reporter=json
//   node scripts/uncovered-branches.mjs tools/rede.ts tools/anfragen.ts
import fs from 'node:fs';

const cov = JSON.parse(fs.readFileSync('coverage/coverage-final.json', 'utf8'));
const want = process.argv.slice(2);

for (const [file, d] of Object.entries(cov)) {
  const short = file.split('\\').join('/').split('/src/')[1];
  if (want.length > 0 && !want.includes(short)) continue;
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const out = [];
  for (const [id, counts] of Object.entries(d.b)) {
    counts.forEach((c, i) => {
      if (c !== 0) return;
      const line = d.branchMap[id].locations[i].start.line;
      out.push(`${line}: ${lines[line - 1].trim().slice(0, 120)}`);
    });
  }
  console.log(`== ${short} (${out.length})`);
  console.log([...new Set(out)].join('\n'));
}
