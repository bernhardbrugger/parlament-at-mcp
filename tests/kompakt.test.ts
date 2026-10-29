import { describe, expect, it } from 'vitest';
import { KOMPAKT_HINWEIS } from '../src/output.js';
import { formatAnfragen, parseAnfragen } from '../src/tools/anfragen.js';
import { formatGegenstaende, parseGegenstaende } from '../src/tools/gegenstaende.js';
import { formatSitzungen, parseSitzungen } from '../src/tools/sitzungen.js';
import { formatPersons, type Person } from '../src/tools/abgeordnete.js';
import { fixture } from './helpers.js';

/** Lines that describe a hit: they start with "- " (header lines and hints do not). */
const hitLines = (text: string) => text.split('\n').filter((l) => l.startsWith('- '));
/** Continuation lines of a block ("  Status: ...", "  https://..."), which the compact mode must not produce. */
const blockLines = (text: string) => text.split('\n').filter((l) => l.startsWith('  '));

describe('compact list mode (real fixtures)', () => {
  it('parl_anfragen: one line per hit with citation, date and link, at most half the size', () => {
    const items = parseAnfragen(fixture('anfragen-wfp005-page1.json'));
    const q = { gremium: 'NR' as const, art: 'anfrage' as const, limit: items.length, offset: 0 };
    const full = formatAnfragen({ total: 7562, items }, q);
    const short = formatAnfragen({ total: 7562, items }, { ...q, kompakt: true });
    expect(hitLines(short)).toHaveLength(items.length);
    expect(blockLines(short)).toEqual([]);
    expect(hitLines(short)[0]).toMatch(/^- 7436\/J · 2026-10-27 · .+ · https:\/\/www\.parlament\.gv\.at\/gegenstand\/XXVIII\/J\/7436$/);
    expect(short).toContain('7562 Treffer, angezeigt 1–12.');
    expect(short).toContain(KOMPAKT_HINWEIS);
    expect(full).not.toContain(KOMPAKT_HINWEIS);
    expect(short.length).toBeLessThan(full.length * 0.75);
  });

  it('parl_anfragen: long subjects are cut to 100 characters, every link survives', () => {
    const items = parseAnfragen(fixture('anfragen-wfp005-page1.json'));
    const long = { ...items[0]!, betreff: 'Wort '.repeat(80).trim() };
    const short = formatAnfragen({ total: 1, items: [long] }, { gremium: 'NR', art: 'anfrage', limit: 1, offset: 0, kompakt: true });
    const line = hitLines(short)[0]!;
    expect(line).toContain('…');
    expect(line.length).toBeLessThan(220);
    for (const it of items) {
      const text = formatAnfragen({ total: 1, items: [it] }, { gremium: 'NR', art: 'anfrage', limit: 1, offset: 0, kompakt: true });
      if (it.url) expect(text).toContain(it.url);
    }
  });

  it('parl_gegenstaende: one line per bill, topics and votes left out', () => {
    const items = parseGegenstaende(fixture('items-101-rv-xxviii.json'));
    const q = { gremium: 'NR' as const, art: 'RV' as const, limit: 5, offset: 0 };
    const full = formatGegenstaende({ total: 128, items }, q);
    const short = formatGegenstaende({ total: 128, items }, { ...q, kompakt: true });
    expect(hitLines(short)).toHaveLength(items.length);
    expect(blockLines(short)).toEqual([]);
    expect(short).toContain(
      '- 251/I · 2025-10-15 · Wasserstraßengesetz, Schifffahrtsgesetz, Änderung · https://www.parlament.gv.at/gegenstand/XXVIII/I/251',
    );
    expect(short).not.toContain('Themen:');
    expect(full).toContain('Themen:');
    expect(short.length).toBeLessThan(full.length);
  });

  it('parl_sitzungen: the title is dropped when it only repeats the number', () => {
    const items = parseSitzungen(fixture('sessions-701-nr-xxviii.json'));
    const q = { gremium: 'NR' as const, limit: items.length, offset: 0 };
    const short = formatSitzungen({ total: 104, items }, { ...q, kompakt: true });
    expect(hitLines(short)).toHaveLength(items.length);
    expect(blockLines(short)).toEqual([]);
    expect(short).toContain('- Sitzung 104 · 2026-10-15 · Zuweisungssitzung · https://www.parlament.gv.at/gegenstand/XXVIII/NRSITZ/104');
    const noNumber = { ...items[0]!, nummer: null, titel: 'Sondersitzung' };
    expect(formatSitzungen({ total: 1, items: [noNumber] }, { ...q, kompakt: true })).toContain('Sondersitzung');
  });

  it('parl_abgeordnete: name, function, current club and id on one line', () => {
    const p: Person = {
      padIntern: 2,
      name: 'Mueller Bernd',
      funktion: 'Klubobmann',
      gremien: ['NR', 'BR'],
      geschlecht: null,
      url: 'https://www.parlament.gv.at/person/2',
      portraitUrl: null,
      aktuell: { gremium: 'NR', klub: 'FPÖ', wahlkreis: '4D Traunviertel', bundesland: 'Oberösterreich' },
    };
    const former: Person = {
      ...p,
      padIntern: 4,
      name: 'Straßer Hans',
      funktion: null,
      aktuell: null,
      url: 'https://www.parlament.gv.at/person/4',
    };
    const short = formatPersons({ total: 2, items: [p, former] }, { limit: 20, offset: 0, kompakt: true });
    expect(hitLines(short)).toEqual([
      '- Mueller Bernd · Klubobmann · NR FPÖ · pad_intern 2 · https://www.parlament.gv.at/person/2',
      '- Straßer Hans · pad_intern 4 · https://www.parlament.gv.at/person/4',
    ]);
    expect(short).toContain(KOMPAKT_HINWEIS);
  });
});
