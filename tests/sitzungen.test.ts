import { describe, expect, it } from 'vitest';
import { fetchSlice, isoFromDe, PAGE_SIZE } from '../src/paging.js';
import { formatSitzungen, parseSitzungen, searchSitzungen, type SitzungenQuery } from '../src/tools/sitzungen.js';
import { filterResponseSchema } from '../src/types.js';
import { clientWith, fixture, fixtureText, json } from './helpers.js';

const base: SitzungenQuery = { gremium: 'NR', limit: 10, offset: 0 };

describe('sessions list (real fixtures, list 701)', () => {
  const nr = fixture('sessions-701-nr-xxviii.json');
  const br = fixture('sessions-701-br.json');

  it('pass the envelope schema although most columns have no label', () => {
    expect(filterResponseSchema.safeParse(nr).success).toBe(true);
    expect(nr.header.filter((h: { label?: string }) => h.label === undefined).length).toBeGreaterThan(10);
  });

  it('parse National Council sessions', () => {
    const [first, second] = parseSitzungen(nr);
    expect(first).toMatchObject({
      gremium: 'NR',
      gp: 'XXVIII',
      nummer: 104,
      datum: '2026-10-15',
      art: 'Zuweisungssitzung',
      path: '/gegenstand/XXVIII/NRSITZ/104',
      url: 'https://www.parlament.gv.at/gegenstand/XXVIII/NRSITZ/104',
    });
    expect(first!.titel).toContain('104. Sitzung des Nationalrats');
    expect(second).toMatchObject({ nummer: 103, art: 'Sitzung' });
  });

  it('parse Federal Council sessions', () => {
    const [first] = parseSitzungen(br);
    expect(first).toMatchObject({ gremium: 'BR', nummer: 997, datum: '2026-10-22', path: '/gegenstand/BR/BRSITZ/997' });
  });
});

describe('searchSitzungen', () => {
  it('posts array filters to list 701, newest first', async () => {
    const { client, fetchImpl } = clientWith(() => json(fixtureText('sessions-701-nr-xxviii.json')));
    const res = await searchSitzungen(client, { ...base, gp: 'XXVIII', limit: 2 });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/Filter/api/filter/data/701?');
    expect(url).toContain('page=1');
    expect(url).toContain('pagesize=50');
    expect(url).toContain('ascDesc=DESC');
    expect(JSON.parse(init.body as string)).toEqual({ GREMIUM: ['NR'], SIAKT: ['SI'], GP_CODE: ['XXVIII'] });
    expect(res.total).toBe(104);
    expect(res.items.map((s) => s.nummer)).toEqual([104, 103]);
  });

  it('does not send a legislative period for the Bundesrat', async () => {
    const { client, fetchImpl } = clientWith(() => json(fixtureText('sessions-701-br.json')));
    await searchSitzungen(client, { gremium: 'BR', limit: 1, offset: 0 });
    expect(JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toEqual({
      GREMIUM: ['BR'],
      SIAKT: ['SI'],
    });
  });
});

describe('formatSitzungen', () => {
  it('lists number, date, kind, title and link', () => {
    const items = parseSitzungen(fixture('sessions-701-nr-xxviii.json'));
    const text = formatSitzungen({ total: 104, items }, { ...base, limit: items.length });
    expect(text).toContain(`104 Sitzungen, angezeigt 1–${items.length}.`);
    expect(text).toContain('Sitzung 104 · 2026-10-15 · Zuweisungssitzung');
    expect(text).toContain('https://www.parlament.gv.at/gegenstand/XXVIII/NRSITZ/104');
    expect(text).toContain('parl_sitzung');
  });

  it('explains empty results', () => {
    expect(formatSitzungen({ total: 0, items: [] }, base)).toContain('Keine Sitzungen');
  });
});

describe('fetchSlice / isoFromDe', () => {
  it('reads only the pages that cover the range', async () => {
    const pages: number[] = [];
    const res = await fetchSlice(48, 5, async (page) => {
      pages.push(page);
      return { total: 200, rows: Array.from({ length: PAGE_SIZE }, (_, i) => (page - 1) * PAGE_SIZE + i), rawRows: PAGE_SIZE };
    });
    expect(pages).toEqual([1, 2]);
    expect(res.items).toEqual([48, 49, 50, 51, 52]);
  });

  it('stops at a short last page', async () => {
    const res = await fetchSlice(0, 50, async () => ({ total: 3, rows: [1, 2, 3], rawRows: 3 }));
    expect(res.items).toEqual([1, 2, 3]);
  });

  it('converts German dates', () => {
    expect(isoFromDe('15.10.2026')).toBe('2026-10-15');
    expect(isoFromDe('2026-10-15')).toBeNull();
    expect(isoFromDe(undefined)).toBeNull();
  });
});
