import { describe, expect, it } from 'vitest';
import { buildBody, formatGegenstaende, parseGegenstaende, searchGegenstaende, type GegenstaendeQuery } from '../src/tools/gegenstaende.js';
import { formatGegenstand } from '../src/tools/gegenstand.js';
import { detailSchema } from '../src/types.js';
import { clientWith, fixture, fixtureText, json } from './helpers.js';

const base: GegenstaendeQuery = { gremium: 'NR', art: 'RV', limit: 15, offset: 0 };

describe('items list (real fixture, list 101)', () => {
  const rv = fixture('items-101-rv-xxviii.json');

  it('parses bills with citation, date, topics and the vote', () => {
    const items = parseGegenstaende(rv);
    expect(items).toHaveLength(5);
    expect(items[0]).toMatchObject({
      zitation: '251/I',
      nummerText: '251 d.B.',
      datum: '2025-10-15',
      art: 'RV',
      url: 'https://www.parlament.gv.at/gegenstand/XXVIII/I/251',
    });
    expect(items[0]!.betreff).toBe('Wasserstraßengesetz, Schifffahrtsgesetz, Änderung');
    expect(items[0]!.artLang).toContain('Regierungsvorlage');
    expect(items[0]!.themen).toContain('Verkehr und Infrastruktur');
    expect(items[0]!.schlagworte.length).toBeGreaterThan(0);
  });

  it('formats a readable list that points to parl_gegenstand', () => {
    const items = parseGegenstaende(rv);
    const text = formatGegenstaende({ total: 128, items }, { ...base, limit: 5 });
    expect(text).toContain('128 Treffer (Regierungsvorlage), angezeigt 1–5. Weitere mit offset=5.');
    expect(text).toContain('251/I · 251 d.B. · 2025-10-15');
    expect(text).toContain('parl_gegenstand');
  });
});

describe('buildBody / searchGegenstaende', () => {
  it('uses array values and only the filters that are set', () => {
    expect(buildBody({ gremium: 'NR', art: 'RV' })).toEqual({ NRBR: ['NR'], VHG: ['RV'] });
    expect(buildBody({ gremium: 'BR', art: 'ANTR', gp: 'XXVIII', schlagwort: 'Verwaltungsverfahren' })).toEqual({
      NRBR: ['BR'],
      VHG: ['ANTR'],
      GP_CODE: ['XXVIII'],
      SW: ['Verwaltungsverfahren'],
    });
  });

  it('posts to list 101 page by page', async () => {
    const { client, fetchImpl } = clientWith(() => json(fixtureText('items-101-rv-xxviii.json')));
    const res = await searchGegenstaende(client, { ...base, gp: 'XXVIII', limit: 3 });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/Filter/api/filter/data/101?');
    expect(url).toContain('pagesize=50');
    expect(JSON.parse(init.body as string)).toEqual({ NRBR: ['NR'], VHG: ['RV'], GP_CODE: ['XXVIII'] });
    expect(res.items.map((i) => i.zitation)).toHaveLength(3);
    expect(res.total).toBe(128);
  });

  it('explains empty results', () => {
    expect(formatGegenstaende({ total: 0, items: [] }, base)).toContain('Schlagwörter sind amtliche Begriffe');
  });
});

describe('parl_gegenstand for a bill (real fixture)', () => {
  const detail = fixture('detail-rv-251.json');

  it('validates against the schema', () => {
    expect(detailSchema.safeParse(detail).success).toBe(true);
  });

  it('shows where the bill stands, the vote, the Bundesgesetzblatt and the short info', () => {
    const text = formatGegenstand(detail, '/gegenstand/XXVIII/I/251');
    expect(text).toContain('Nr. 251 d.B.');
    expect(text).toContain('Mitglied der Bundesregierung: Peter Hanke');
    expect(text).toContain('Stand: Beschlossen im Bundesrat 89/BNR · Einstimmig');
    expect(text).toContain('Bundesgesetzblatt I Nr. 86/2025');
    expect(text).toContain('Abstimmung: Dafür: F, V, S, N, G, Dagegen: -');
    expect(text).toContain('Kurzinformation:');
    expect(text).toContain('- Direkte Zahlung an via donau');
    expect(text).toContain('Verfahren:');
    expect(text).toContain('Einlangen NR:');
    expect(text).toContain('Ausschussberatungen NR:');
    expect(text).toContain('Quelle: https://www.parlament.gv.at/gegenstand/XXVIII/I/251');
    expect(text).not.toMatch(/<a |<br|<\/li>/);
  });
});
