import { describe, expect, it } from 'vitest';
import { buildBody, formatAnfragen, parseAnfragen, searchAnfragen, type AnfragenQuery } from '../src/tools/anfragen.js';
import { filterResponseSchema, rowsToObjects } from '../src/types.js';
import { clientWith, fixture, json, syntheticPage } from './helpers.js';

const base: AnfragenQuery = { gremium: 'NR', art: 'anfrage', limit: 15, offset: 0 };

describe('real fixtures (WFP_005, trimmed)', () => {
  const inquiries = fixture('anfragen-wfp005-page1.json');
  const answers = fixture('beantwortungen-wfp005-page1.json');

  it('pass the envelope schema even though the link columns have no rnr', () => {
    expect(filterResponseSchema.safeParse(inquiries).success).toBe(true);
    const row = rowsToObjects(inquiries)[0]!;
    expect(row['Nr.']).toBe('7436/J');
    expect(row['link']).toBe('/gegenstand/XXVIII/J/7436');
    expect(row['link_2']).toBe('/gegenstand/XXVIII/J/7436');
  });

  it('parse inquiries into clean items', () => {
    const items = parseAnfragen(inquiries);
    expect(items).toHaveLength(12);
    expect(items[0]).toMatchObject({
      zitation: '7436/J',
      datum: '2026-10-27',
      artCode: 'J',
      art: 'Schriftliche Anfrage',
      url: 'https://www.parlament.gv.at/gegenstand/XXVIII/J/7436',
    });
    expect(items[0]!.betreff).toContain('Digitalzwang');
    expect(items[0]!.status).toBe('Einlangen im Nationalrat (Frist: 27.12.2026)');
    expect(items[0]!.betreff).not.toMatch(/<|>/);
  });

  it('parse answers', () => {
    const [first] = parseAnfragen(answers);
    expect(first).toMatchObject({ zitation: '6209/AB', artCode: 'AB', art: 'Anfragebeantwortung', datum: '2026-10-23' });
  });
});

describe('buildBody', () => {
  it('uses arrays for every value (plain strings make the server answer 500)', () => {
    const body = buildBody({ gremium: 'NR', gp: 'XXVIII', art: 'anfrage', suche: 'Budget' });
    expect(body).toEqual({ NRBR: ['NR'], GP: ['XXVIII'], JMAB: ['J_JPR_M'], SUCH: ['Budget'] });
    for (const v of Object.values(body)) expect(Array.isArray(v)).toBe(true);
  });

  it('always sets exactly one art filter, because the server cannot combine them', () => {
    expect(buildBody({ gremium: 'BR', art: 'anfrage' })).toEqual({ NRBR: ['BR'], JMAB: ['J_JPR_M'] });
    expect(buildBody({ gremium: 'NR', art: 'beantwortung' })).toEqual({ NRBR: ['NR'], JMAB: ['AB_ABPR_ABM'] });
  });
});

describe('searchAnfragen paging', () => {
  it('requests one page when the range fits and slices it', async () => {
    const urls: string[] = [];
    const { client } = clientWith((url) => {
      urls.push(url);
      return json(syntheticPage(120, 7000, 50));
    });
    const res = await searchAnfragen(client, { ...base, limit: 5, offset: 3 });
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain('pageNumber=1');
    expect(res.total).toBe(120);
    expect(res.items.map((i) => i.zitation)).toEqual(['6997/J', '6996/J', '6995/J', '6994/J', '6993/J']);
  });

  it('spans two pages when the range crosses a page boundary', async () => {
    const urls: string[] = [];
    const { client } = clientWith((url) => {
      urls.push(url);
      return json(url.includes('pageNumber=1') ? syntheticPage(120, 7000, 50) : syntheticPage(120, 6950, 50));
    });
    const res = await searchAnfragen(client, { ...base, limit: 6, offset: 47 });
    expect(urls.map((u) => /pageNumber=(\d+)/.exec(u)![1])).toEqual(['1', '2']);
    expect(res.items.map((i) => i.zitation)).toEqual(['6953/J', '6952/J', '6951/J', '6950/J', '6949/J', '6948/J']);
  });

  it('starts at the right page for a large offset', async () => {
    const urls: string[] = [];
    const { client } = clientWith((url) => {
      urls.push(url);
      return json(syntheticPage(500, 6000, 50));
    });
    await searchAnfragen(client, { ...base, limit: 10, offset: 120 });
    expect(urls[0]).toContain('pageNumber=3');
  });

  it('stops at the last, short page', async () => {
    const { client, fetchImpl } = clientWith(() => json(syntheticPage(12, 100, 12)));
    const res = await searchAnfragen(client, { ...base, limit: 50 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(res.items).toHaveLength(12);
  });
});

describe('formatAnfragen', () => {
  it('lists items with number, date, subject, status and link', () => {
    const items = parseAnfragen(fixture('anfragen-wfp005-page1.json')).slice(0, 2);
    const text = formatAnfragen({ total: 7562, items }, { ...base, limit: 2 });
    expect(text).toContain('7562 Treffer, angezeigt 1–2.');
    expect(text).toContain('Weitere Treffer mit offset=2.');
    expect(text).toContain('7436/J · 2026-10-27 · Schriftliche Anfrage');
    expect(text).toContain('https://www.parlament.gv.at/gegenstand/XXVIII/J/7436');
    expect(text).toContain('parl_gegenstand');
  });

  it('warns when the reported count hits the cap', () => {
    const items = parseAnfragen(fixture('anfragen-wfp005-page1.json')).slice(0, 1);
    const text = formatAnfragen({ total: 20004, items }, base);
    expect(text).toContain('mindestens 20004 Treffer');
    expect(text).toContain('eingrenzen');
  });

  it('explains empty results and out-of-range offsets', () => {
    expect(formatAnfragen({ total: 0, items: [] }, base)).toContain('Keine Treffer');
    expect(formatAnfragen({ total: 40, items: [] }, { ...base, offset: 100 })).toContain('insgesamt 40');
  });
});
