// Live smoke test: starts the BUILT server (dist/) and calls every tool once against the real Parliament API.
// Usage: npm run build && npm run smoke:live          (about 8 requests, ~10 s because of the 1 s pause)
// Add one call per new tool; fixtures alone do not prove that a tool works against the real API.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';

const entry = fileURLToPath(new URL('../dist/index.js', import.meta.url));
const transport = new StdioClientTransport({ command: process.execPath, args: [entry], stderr: 'ignore' });
const client = new Client({ name: 'smoke-live', version: '0' });
await client.connect(transport);

const calls = [
  ['parl_abgeordnete', { name: 'Rendi-Wagner', limit: 2 }, /Rendi-Wagner/],
  ['parl_anfragen', { gp: 28, limit: 3 }, /\/J/],
  ['parl_gegenstand', { gp: 28, zitation: '6209/AB' }, /Beantwortet durch/],
  ['parl_gegenstaende', { gp: 28, limit: 2 }, /Regierungsvorlage/],
  ['parl_gegenstand', { gp: 28, zitation: '251/I' }, /Verfahren:/],
  ['parl_sitzungen', { gp: 28, limit: 2 }, /Sitzung \d+/],
  ['parl_sitzung', { gp: 28, nummer: 30, redner: 'Kickl' }, /rede=\d+/],
  ['parl_rede', { gp: 28, nummer: 30, rede: 801352, max_zeichen: 1500 }, /Kickl[\s\S]*\d+ Absätze, in eckigen Klammern nummeriert/],
  ['parl_rede', { gp: 28, nummer: 30, rede: 801352, absaetze: '2-3' }, /Absätze 2–3 von \d+[\s\S]*\[2\] [\s\S]*\[3\] /],
  ['parl_abgeordnete', { nur_aktuell: true, klub: 'SPÖ', bundesland: 'Wien', limit: 3 }, /AKTUELL im (Nationalrat|Bundesrat)/],
  ['parl_person', { name: 'Rendi-Wagner' }, /Mandate und Funktionen/],
  ['parl_reden_person', { name: 'Rendi-Wagner', limit: 3 }, /Reden von/],
  ['parl_ausschuesse', { gp: 28 }, /Ausschuss/],
  ['parl_ausschuesse', { gp: 28, suche: 'Finanzausschuss' }, /Vorsitz/],
  ['parl_ausschuesse', { gremium: 'BR' }, /Ausschuss/],
  ['parl_gegenstaende', { gp: 28, art: 'PET', limit: 3 }, /\/PET/],
  ['parl_gegenstaende', { gp: 28, art: 'BI', limit: 3 }, /\/BI/],
  ['parl_gegenstaende', { gp: 28, art: 'EU', limit: 3 }, /\/EU/],
  ['parl_gegenstand', { gp: 28, zitation: '21/PET' }, /Parlamentskorrespondenz/],
  ['parl_beschluesse', { gp: 28, nummer: 30, top: 'TOP 3' }, /Dafür: ÖVP, SPÖ, NEOS, dagegen: FPÖ, GRÜNE/],
  [
    'parl_anfragen',
    { gp: 28, limit: 5, kompakt: true },
    /\n- \d+\/J · \d{4}-\d{2}-\d{2} · .+ · https:\/\/www\.parlament\.gv\.at\/[\s\S]*Kompaktansicht/,
  ],
  [
    'parl_suche',
    { suche: 'Ich rede vom Staatsbesuch', modus: 'phrase' },
    /2025-06-16 · Herbert Kickl \(FPÖ\)[\s\S]*Wortlaut: parl_rede gremium=NR gp=XXVIII nummer=30 rede=801352/,
  ],
  [
    'parl_suche',
    { suche: 'Staatsbesuch', gp: 28, von: '2025-06-16', bis: '2025-06-16' },
    /Treffer, angezeigt[\s\S]*2025-06-16 · [\s\S]*nummer=30/,
  ],
  ['parl_suche', { suche: 'Staatsbesuch', gp: 28, redner: 'Kickl' }, /Treffer von "Kickl" unter den \d+ geprüften[\s\S]*Herbert Kickl/],
  ['parl_suche', { suche: 'Klimaschutz', gremium: 'BR', limit: 3 }, /Wortlaut: parl_rede gremium=BR nummer=\d+ rede=\d+/],
  ['parl_suche', { suche: 'Klimaschutz', bereich: 'pressemeldungen', nur_titel: true, limit: 3 }, /aktuelles\/pk\//],
  [
    'parl_suche',
    { suche: 'Klimaschutz', bereich: 'gegenstaende', nur_titel: true, limit: 3 },
    /Details: parl_gegenstand gp=[IVXL]+ zitation=/,
  ],
  ['parl_suche', { suche: 'xyzzy plugh nonexistentphrase', modus: 'phrase' }, /keine Treffer/],
];

let failed = 0;
for (const [name, args, expected] of calls) {
  let text = '';
  let ok = false;
  try {
    const res = await client.callTool({ name, arguments: args });
    text = res.content?.[0]?.text ?? '';
    ok = !res.isError && expected.test(text);
  } catch (e) {
    text = String(e);
  }
  if (!ok) failed++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name} ${JSON.stringify(args)} (${text.length} chars)`);
  if (!ok) console.log('     ' + text.slice(0, 300).replace(/\n/g, ' '));
}
// The list has no useful order of its own: the tool must ask for the newest first (a bill from 2026 must come before one from 2025).
for (const art of ['RV', 'PET']) {
  const res = await client.callTool({ name: 'parl_gegenstaende', arguments: { gp: 28, art, limit: 5 } });
  const dates = (res.structuredContent?.items ?? []).map((i) => i.datum);
  const sorted = [...dates].sort().reverse();
  const ok = dates.length === 5 && dates.every((d, i) => d === sorted[i]);
  if (!ok) failed++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} parl_gegenstaende art=${art} comes newest first (${dates.join(', ')})`);
}
// The whole fact-check chain: search for a quote, then read the speech with exactly the arguments the hit names.
{
  const found = await client.callTool({ name: 'parl_suche', arguments: { suche: 'Ich rede vom Staatsbesuch', modus: 'phrase' } });
  const rede = found.structuredContent?.items?.[0]?.rede;
  let ok = false;
  let detail = 'no speech hit';
  if (rede) {
    const args = { gremium: rede.gremium, ...(rede.gp ? { gp: rede.gp } : {}), nummer: rede.sitzung, rede: rede.rede };
    const speech = await client.callTool({ name: 'parl_rede', arguments: args });
    const text = speech.content?.[0]?.text ?? '';
    ok = !speech.isError && /Kickl/.test(text) && /Ich rede vom Staatsbesuch/.test(text) && /\[\d+\] /.test(text);
    detail = `${JSON.stringify(args)} -> ${text.length} chars`;
  }
  if (!ok) failed++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} parl_suche -> parl_rede chain: the found quote is in the speech (${detail})`);
}
await client.close();
console.log(failed ? `\n${failed} live check(s) failed.` : '\nAll live checks passed.');
process.exit(failed ? 1 : 0);
