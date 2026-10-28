// Fetches detail pages (?json=TRUE) and prints their shape. Usage: node scripts/probe-detail.mjs /gegenstand/XXVIII/PET/21 [--save dir]
import fs from 'node:fs';

const args = process.argv.slice(2);
const saveAt = args.indexOf('--save');
const saveDir = saveAt >= 0 ? args[saveAt + 1] : null;
const paths = args.filter((a, i) => a.startsWith('/') && i !== saveAt + 1);

for (const path of paths) {
  const res = await fetch(`https://www.parlament.gv.at${path}?json=TRUE`, {
    headers: { 'user-agent': 'parlament-at-mcp probe (+https://github.com/bernhardbrugger/parlament-at-mcp)' },
  });
  const text = await res.text();
  console.log(`== ${path} HTTP ${res.status} ${text.length} bytes`);
  if (!res.ok) continue;
  const j = JSON.parse(text);
  const c = j.content ?? {};
  for (const [k, v] of Object.entries(c)) {
    const t = Array.isArray(v)
      ? `array(${v.length})`
      : v && typeof v === 'object'
        ? `object{${Object.keys(v).slice(0, 8).join(',')}}`
        : JSON.stringify(v)?.slice(0, 90);
    console.log(`  ${k}: ${t}`);
  }
  if (saveDir) {
    fs.mkdirSync(saveDir, { recursive: true });
    fs.writeFileSync(`${saveDir}/${path.split('/').slice(2).join('-')}.json`, text);
  }
  await new Promise((r) => setTimeout(r, 1000));
}
