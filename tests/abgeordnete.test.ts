import { describe, expect, it, vi } from 'vitest';
import { ParlamentClient } from '../src/client.js';
import {
  cleanText,
  describeCurrent,
  fold,
  formatPersons,
  loadCurrentMembers,
  loadPersons,
  searchPersons,
} from '../src/tools/abgeordnete.js';
import { filterResponseSchema, rowsToObjects } from '../src/types.js';
import { fixture, fixtureText, json } from './helpers.js';

/** A client that answers the three lists the persons tool needs from recorded real data. */
function routed(opts: { currentFails?: boolean } = {}) {
  const hits = { persons: 0, nr: 0, br: 0 };
  const client = new ParlamentClient({
    delayMs: 0,
    retries: 0,
    sleep: async () => {},
    fetchImpl: (async (url: string) => {
      if (url.includes('/filter/data/10400')) {
        hits.persons++;
        return json(fixtureText('persons-10400.json'));
      }
      if (url.includes('FBEZ=WFW_002')) {
        hits.nr++;
        return opts.currentFails ? new Response('boom', { status: 500 }) : json(fixtureText('members-wfw002-nr.json'));
      }
      if (url.includes('FBEZ=WFW_005')) {
        hits.br++;
        return opts.currentFails ? new Response('boom', { status: 500 }) : json(fixtureText('members-wfw005-br.json'));
      }
      throw new Error(`unexpected request ${url}`);
    }) as unknown as typeof fetch,
  });
  return { client, hits };
}

describe('real API fixtures', () => {
  it('persons list matches the envelope schema and maps rows to objects', () => {
    const fx = fixture('persons-10400.json');
    expect(filterResponseSchema.safeParse(fx).success).toBe(true);
    expect(rowsToObjects(fx)[0]).toMatchObject({ Name: 'Achatz Karin', pad_intern: 576, geschl: 'W', link: '/person/576' });
  });

  it('current-member list: column positions come from the header index, not from rnr', () => {
    // rnr numbers this list 1, 2, 4, 5, ... (3 is missing), so rnr - 1 would shift Wahlkreis and Bundesland
    const nr = fixture('members-wfw002-nr.json');
    expect(nr.header.map((h: { rnr?: number }) => h.rnr).slice(0, 4)).toEqual([1, 2, 4, 5]);
    const row = rowsToObjects(nr)[1]!;
    expect(row['Name']).toBe('Auer Katrin, Mag.');
    expect(row['Wahlkreis']).toBe('4D Traunviertel');
    expect(String(row['Bundesland'])).toContain('Oberösterreich');
    expect(row['link']).toBe('/person/30688');
  });

  it('falls back to rnr when header and rows differ in length', () => {
    const resp = filterResponseSchema.parse({
      pages: 1,
      count: 1,
      header: [
        { rnr: 1, label: 'a' },
        { rnr: 3, label: 'c' },
      ],
      rows: [['x', 'y', 'z']],
    });
    expect(rowsToObjects(resp)[0]).toEqual({ a: 'x', c: 'z' });
  });
});

describe('text cleaning', () => {
  it('keeps text of markup and decodes entities', () => {
    expect(cleanText('Arpa Claudia, Mag.<sup>a</sup>')).toBe('Arpa Claudia, Mag.a');
    expect(cleanText('A &amp; B&nbsp;C <b>x</b>')).toBe('A & B C x');
  });

  it('decodes named and numeric entities, in one pass', () => {
    expect(cleanText('Erm&auml;chtigung &amp; Verpflichtung')).toBe('Ermächtigung & Verpflichtung');
    expect(cleanText('&sect; 12 &ndash; &bdquo;Test&ldquo; &#8364; &#x20AC;')).toBe('§ 12 – „Test“ € €');
    expect(cleanText('&amp;lt;b&amp;gt;')).toBe('&lt;b&gt;');
    expect(cleanText('&unknown; &#0; &#99999999;')).toBe('&unknown; &#0; &#99999999;');
  });

  it('folds case and diacritics', () => {
    expect(fold('Östermayer')).toBe('ostermayer');
    expect(fold('Weiß')).toBe('weiss');
  });
});

describe('loadCurrentMembers', () => {
  it('reads both chambers and keys them by pad_intern', async () => {
    const { client } = routed();
    const members = await loadCurrentMembers(client);
    expect(members.size).toBe(14);
    expect(members.get(38385)).toEqual({
      gremium: 'NR',
      klub: 'NEOS',
      wahlkreis: 'B Bundeswahlvorschlag',
      bundesland: 'Bundeswahlvorschlag',
    });
    expect(members.get(30688)).toMatchObject({ gremium: 'NR', klub: 'SPÖ', bundesland: 'Oberösterreich' });
    expect(members.get(24110)).toEqual({ gremium: 'BR', klub: 'SPÖ', wahlkreis: '2 Kärnten', bundesland: 'Kärnten' });
  });

  it('asks for both genders, because an empty body is answered with an error message', async () => {
    const bodies: unknown[] = [];
    const client = new ParlamentClient({
      delayMs: 0,
      fetchImpl: (async (_url: string, init: RequestInit) => {
        bodies.push(JSON.parse(String(init.body)));
        return json({ pages: 1, count: 0, header: [], rows: [] });
      }) as unknown as typeof fetch,
    });
    await loadCurrentMembers(client);
    expect(bodies).toEqual([
      { M: ['M'], W: ['W'] },
      { M: ['M'], W: ['W'] },
    ]);
  });
});

describe('loadPersons', () => {
  it('normalises the fixture, marks current members and caches both lists', async () => {
    const { client, hits } = routed();
    const persons = await loadPersons(client);
    await loadPersons(client);
    expect(hits).toEqual({ persons: 1, nr: 1, br: 1 });
    expect(persons).toHaveLength(fixture('persons-10400.json').rows.length);
    const arpa = persons.find((p) => p.padIntern === 24110)!;
    expect(arpa.name).toBe('Arpa Claudia, Mag.a'); // <sup> stripped
    expect(arpa.gremien).toEqual(['BR', 'MPO']);
    expect(arpa.url).toBe('https://www.parlament.gv.at/person/24110');
    expect(arpa.portraitUrl).toMatch(/^https:\/\/www\.parlament\.gv\.at\/dokument\/bild\//);
    expect(arpa.geschlecht).toBe('W');
    expect(arpa.aktuell).toMatchObject({ gremium: 'BR', klub: 'SPÖ' });
    expect(persons.find((p) => p.padIntern === 38385)!.aktuell).toMatchObject({ gremium: 'NR', klub: 'NEOS' });
    expect(persons.filter((p) => p.aktuell)).toHaveLength(2);
  });

  it('still works when the current-member lists fail', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { client } = routed({ currentFails: true });
    const persons = await loadPersons(client);
    expect(persons.length).toBeGreaterThan(20);
    expect(persons.every((p) => p.aktuell === null)).toBe(true);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('current members unavailable'));
    spy.mockRestore();
  });
});

describe('searchPersons', () => {
  const q = { limit: 100, offset: 0 };

  it('finds by name parts regardless of order, case and diacritics', async () => {
    const all = await loadPersons(routed().client);
    expect(searchPersons(all, { ...q, name: 'rendi wagner' }).items.map((p) => p.padIntern)).toEqual([91034]);
    expect(searchPersons(all, { ...q, name: 'KICKL' }).total).toBe(1);
    expect(searchPersons(all, { ...q, name: 'Appe' }).items[0]?.name).toContain('Appé');
  });

  it('filters by gremium and funktion', async () => {
    const all = await loadPersons(routed().client);
    const bureg = searchPersons(all, { ...q, gremium: 'bureg' });
    expect(bureg.total).toBeGreaterThan(3);
    expect(bureg.items.every((p) => p.gremien.includes('BuREG'))).toBe(true);
    expect(searchPersons(all, { ...q, funktion: 'volksanwalt' }).items.map((p) => p.name)).toEqual(['Achitz Bernhard, Mag.']);
  });

  it('filters current members by flag, club and Bundesland', async () => {
    const all = await loadPersons(routed().client);
    expect(
      searchPersons(all, { ...q, nurAktuell: true })
        .items.map((p) => p.padIntern)
        .sort(),
    ).toEqual([24110, 38385]);
    expect(searchPersons(all, { ...q, klub: 'neos' }).items.map((p) => p.padIntern)).toEqual([38385]);
    expect(searchPersons(all, { ...q, klub: 'SPÖ' }).items.map((p) => p.padIntern)).toEqual([24110]);
    expect(searchPersons(all, { ...q, bundesland: 'kärnten' }).items.map((p) => p.padIntern)).toEqual([24110]);
    expect(searchPersons(all, { ...q, klub: 'FPÖ' }).total).toBe(0); // nobody in the fixture
    expect(searchPersons(all, { ...q, nurAktuell: true, name: 'arpa' }).total).toBe(1);
  });

  it('paginates', async () => {
    const all = await loadPersons(routed().client);
    const page1 = searchPersons(all, { limit: 5, offset: 0 });
    const page2 = searchPersons(all, { limit: 5, offset: 5 });
    expect(page1.total).toBe(all.length);
    expect(page1.items).toHaveLength(5);
    expect(page2.items[0]).not.toEqual(page1.items[0]);
    expect(formatPersons(page1, { limit: 5, offset: 0 })).toContain('Weitere Treffer mit offset=5');
  });

  it('marks current members and points to the person tools', async () => {
    const all = await loadPersons(routed().client);
    const text = formatPersons(searchPersons(all, { ...q, name: 'arpa' }), { ...q, name: 'arpa' });
    expect(text).toContain('AKTUELL im Bundesrat · Klub SPÖ · Wahlkreis 2 Kärnten');
    expect(text).toContain('parl_person');
    expect(text).toContain('parl_reden_person');
  });

  it('explains empty results', () => {
    expect(formatPersons({ total: 0, items: [] }, { limit: 20, offset: 0 })).toContain('Keine Personen gefunden');
  });

  it('does not repeat the Bundesland when the Wahlkreis already names it', () => {
    expect(describeCurrent({ gremium: 'NR', klub: 'GRÜNE', wahlkreis: '9 Wien', bundesland: 'Wien' })).toBe(
      'AKTUELL im Nationalrat · Klub GRÜNE · Wahlkreis 9 Wien',
    );
    expect(
      describeCurrent({ gremium: 'NR', klub: 'FPÖ', wahlkreis: '3G Niederösterreich Ost', bundesland: 'Niederösterreich' }),
    ).not.toMatch(/ · Niederösterreich$/);
    expect(describeCurrent({ gremium: 'NR', klub: 'X', wahlkreis: '4D Traunviertel', bundesland: 'Oberösterreich' })).toMatch(
      / · Oberösterreich$/,
    );
  });
});
