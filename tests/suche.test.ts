import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { ParlamentClient } from '../src/client.js';
import { createServer } from '../src/server.js';
import {
  buildSearchBody,
  cleanSnippet,
  formatSuche,
  isCalendarDay,
  parseHit,
  speakerFromTitle,
  suche,
  viennaDate,
  type SucheQuery,
} from '../src/tools/suche.js';
import { searchResponseSchema } from '../src/types.js';
import { clientWith, fixture, fixtureText, json } from './helpers.js';

const base: SucheQuery = {
  suche: 'Staatsbesuch',
  modus: 'alle',
  bereich: 'reden',
  nurTitel: false,
  sortierung: 'relevanz',
  limit: 10,
  offset: 0,
};
const rows = (name: string) => searchResponseSchema.parse(fixture(name)).rows;

/** A client without waiting and without retries, so a failing page costs nothing. */
function quickClient(handler: (url: string, init: RequestInit) => Response) {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const client = new ParlamentClient({
    delayMs: 0,
    retries: 0,
    sleep: async () => {},
    fetchImpl: (async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      return handler(url, init);
    }) as unknown as typeof fetch,
  });
  return { client, calls };
}

describe('dates', () => {
  it('shows the Austrian calendar day of the stored UTC instant', () => {
    expect(viennaDate('2025-06-15T22:00:00.000Z')).toBe('2025-06-16'); // summer time
    expect(viennaDate('2025-12-09T23:00:00.000Z')).toBe('2025-12-10'); // winter time
    expect(viennaDate('2025-06-16T10:00:00.000Z')).toBe('2025-06-16');
  });

  it.each([null, undefined, '', 'gestern', '2025-13-45T00:00:00Z'])('%j has no date', (v) => expect(viennaDate(v)).toBeNull());

  it.each(['2025-06-16', '2024-02-29', '2000-01-01'])('%s is a day', (s) => expect(isCalendarDay(s)).toBe(true));
  it.each(['2025-02-30', '2023-02-29', '2025-6-1', '16.06.2025', '2025-13-01', '', '2025-06-16T00:00:00Z'])('%j is not a day', (s) =>
    expect(isCalendarDay(s)).toBe(false),
  );
});

describe('snippets and titles', () => {
  it('turns the highlight markup into **bold** and drops other tags and entities', () => {
    expect(
      cleanSnippet('...bei einem <span class="highlight">Staatsbesuch</span> von Bundespräsident Van der Bellen &amp; <i>anderen</i>...'),
    ).toBe('...bei einem **Staatsbesuch** von Bundespräsident Van der Bellen & anderen...');
    expect(cleanSnippet('<span class="highlight">a</span> <span class="highlight">b</span>')).toBe('**a b**');
  });

  it('copes with empty input and stray markers', () => {
    expect(cleanSnippet(null)).toBe('');
    expect(cleanSnippet('')).toBe('');
    expect(cleanSnippet('<span class="highlight"></span>text')).toBe('text');
  });

  it('reads the speaker from the end of a protocol title', () => {
    expect(
      speakerFromTitle('Teil des Vorläufigen Stenogr. Protokolls der 30. Sitzung der XXVIII. GP des Nationalrates: Herbert Kickl (FPÖ)'),
    ).toBe('Herbert Kickl (FPÖ)');
    expect(speakerFromTitle('Ohne Doppelpunkt')).toBeNull();
    expect(speakerFromTitle('Endet mit: ')).toBeNull();
  });
});

describe('parseHit on real answers', () => {
  it('turns a speech hit into the arguments for parl_rede', () => {
    const hit = parseHit(rows('search-reden-phrase.json')[0]!)!;
    expect(hit.rede).toEqual({ gremium: 'NR', gp: 'XXVIII', sitzung: 30, rede: 801352, redner: 'Herbert Kickl (FPÖ)' });
    expect(hit.datum).toBe('2025-06-16');
    expect(hit.ausschnitt).toContain('**Ich rede vom Staatsbesuch** – (auf die Redezeitanzeige');
    expect(hit.ausschnitt).not.toMatch(/<|&[a-z]+;/);
    expect(hit.url).toBe('https://www.parlament.gv.at/dokument/XXVIII/NRSITZ/30/A_-_11_12_46_00801352.html');
    expect(hit.gegenstand).toBeNull();
  });

  it('knows Bundesrat speeches (no legislative period)', () => {
    const hits = rows('search-reden-bundesrat.json').map(parseHit);
    expect(hits).toHaveLength(4);
    for (const h of hits) {
      expect(h!.rede).toMatchObject({ gremium: 'BR', gp: null });
      expect(h!.rede!.sitzung).toBeGreaterThan(900);
      expect(h!.rede!.redner).toBeTruthy();
    }
  });

  it('turns an item hit into the arguments for parl_gegenstand', () => {
    const hits = rows('search-gegenstaende-klima.json').map(parseHit);
    expect(hits[0]!.gegenstand).toEqual({ gp: 'XXVIII', zitation: '5017/J' });
    expect(hits[0]!.rede).toBeNull();
    expect(hits[1]!.gegenstand?.zitation).toBe('824/A');
  });

  it('press releases carry neither', () => {
    const [h] = rows('search-pk-klimaschutz.json').map(parseHit);
    expect(h!.rede).toBeNull();
    expect(h!.gegenstand).toBeNull();
    expect(h!.bereich).toBe('Parlamentskorrespondenz');
    expect(h!.url).toMatch(/^https:\/\/www\.parlament\.gv\.at\/aktuelles\/pk\//);
  });
});

describe('parseHit on odd rows', () => {
  const row = (over: Record<string, unknown>) => searchResponseSchema.parse({ count: 1, rows: [{ title: 'T', ...over }] }).rows[0]!;

  it('skips hits without a title', () => {
    expect(parseHit(row({ title: '' }))).toBeNull();
    expect(parseHit(row({ title: null }))).toBeNull();
  });

  it('only keeps site-relative links', () => {
    expect(parseHit(row({ link: 'https://evil.example/x' }))!.url).toBeNull();
    expect(parseHit(row({ link: '//evil.example/x' }))!.url).toBeNull();
    expect(parseHit(row({ link: '/gegenstand/XXVIII/J/1' }))!.url).toBe('https://www.parlament.gv.at/gegenstand/XXVIII/J/1');
  });

  it('a speech path without the speech type is not offered to parl_rede', () => {
    const link = '/dokument/XXVIII/NRSITZ/30/A_-_11_12_46_00801352.html';
    expect(parseHit(row({ link, item_type: 'stteil' }))!.rede).not.toBeNull();
    expect(parseHit(row({ link, item_type: 'pk' }))!.rede).toBeNull();
    expect(parseHit(row({ link: '/dokument/XXVIII/NRSITZ/30/Tagesordnung.html', item_type: 'stteil' }))!.rede).toBeNull();
  });

  it('survives a missing date, label and snippet', () => {
    expect(parseHit(row({}))).toMatchObject({ datum: null, bereich: null, ausschnitt: '', url: null });
  });
});

describe('buildSearchBody', () => {
  it('sends the query as a plain string and the filters as arrays, like the website', () => {
    expect(buildSearchBody(base)).toEqual({
      searchType: ['all'],
      searchScope: ['all'],
      's.sm.query': 'Staatsbesuch',
      category: ['Protokolle'],
    });
  });

  it('maps every option', () => {
    const body = buildSearchBody({
      ...base,
      modus: 'phrase',
      nurTitel: true,
      bereich: 'gegenstaende',
      gremium: 'NR',
      gp: 'XXVIII',
      von: '2025-06-01',
      bis: '2025-06-30',
    });
    expect(body).toEqual({
      searchType: ['phrase'],
      searchScope: ['title'],
      's.sm.query': 'Staatsbesuch',
      category: ['Verhandlungsgegenstände'],
      gremium: ['Nationalrat'],
      gp_liste: ['XXVIII'],
      date_range: ['2025-06-01T00:00:00.000Z', '2025-06-30T23:59:00.000Z'],
    });
  });

  it('"alles" sets no category; "beliebig" is the server\'s "any"', () => {
    const body = buildSearchBody({ ...base, bereich: 'alles', modus: 'beliebig' });
    expect(body).not.toHaveProperty('category');
    expect(body['searchType']).toEqual(['any']);
  });

  it('the server wants both bounds of a date range: a missing one is filled in', () => {
    expect(buildSearchBody({ ...base, von: '2025-06-01' })['date_range']).toEqual(['2025-06-01T00:00:00.000Z', '2099-12-31T23:59:00.000Z']);
    expect(buildSearchBody({ ...base, bis: '2025-06-30' })['date_range']).toEqual(['1920-01-01T00:00:00.000Z', '2025-06-30T23:59:00.000Z']);
  });

  it('the Bundesrat has no legislative periods: gp is not sent for it', () => {
    expect(buildSearchBody({ ...base, gremium: 'BR', gp: 'XXVIII' })).not.toHaveProperty('gp_liste');
    expect(buildSearchBody({ ...base, gremium: 'BR' })['gremium']).toEqual(['Bundesrat']);
  });
});

describe('suche against recorded answers', () => {
  it('asks for 50 per page and the requested order, and returns the hits', async () => {
    const { client, calls } = quickClient(() => json(fixtureText('search-reden-staatsbesuch.json')));
    const res = await suche(client, { ...base, sortierung: 'neueste' });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain('/Filter/api/filterform/vts/data?');
    expect(calls[0]!.url).toContain('FBEZ=VTS_01');
    expect(calls[0]!.url).toContain('pagesize=50');
    expect(calls[0]!.url).toContain('sort=datedesc');
    expect(res.total).toBe(13);
    expect(res.items).toHaveLength(6);
    expect(res.items[0]!.rede!.redner).toContain('Gasser');
  });

  it('relevance order sends no sort parameter', async () => {
    const { client, calls } = quickClient(() => json(fixtureText('search-reden-staatsbesuch.json')));
    await suche(client, base);
    expect(calls[0]!.url).not.toContain('sort=');
  });

  it('cuts the page to limit and offset', async () => {
    const { client } = quickClient(() => json(fixtureText('search-reden-staatsbesuch.json')));
    const res = await suche(client, { ...base, limit: 2, offset: 1 });
    expect(res.items.map((i) => i.rede!.rede)).toEqual(
      rows('search-reden-staatsbesuch.json')
        .slice(1, 3)
        .map((r) => parseHit(r)!.rede!.rede),
    );
  });

  it('a short page is the last one: no second request', async () => {
    const { client, calls } = quickClient(() => json(fixtureText('search-reden-staatsbesuch.json')));
    await suche(client, { ...base, limit: 50 });
    expect(calls).toHaveLength(1);
  });

  it('reads two pages when the range crosses a page boundary', async () => {
    const page = (n: number) => ({
      count: 120,
      pages: 3,
      rows: Array.from({ length: 50 }, (_, i) => ({ title: `Treffer ${(n - 1) * 50 + i}`, link: '/x', item_type: 'pk' })),
    });
    const { client, calls } = quickClient((url) => json(page(Number(new URL(url).searchParams.get('page')))));
    const res = await suche(client, { ...base, limit: 10, offset: 45 });
    expect(calls.map((c) => new URL(c.url).searchParams.get('page'))).toEqual(['1', '2']);
    expect(res.items.map((i) => i.titel)).toEqual(Array.from({ length: 10 }, (_, i) => `Treffer ${45 + i}`));
    expect(res.total).toBe(120);
  });

  it('a page behind the last one (HTTP 500) means "no more hits", not an error', async () => {
    const { client } = quickClient((url) =>
      new URL(url).searchParams.get('page') === '1'
        ? json({ count: 50, rows: Array.from({ length: 50 }, (_, i) => ({ title: `T${i}` })) })
        : new Response('boom', { status: 500 }),
    );
    const res = await suche(client, { ...base, limit: 10, offset: 50 });
    expect(res.pastEnd).toBe(true);
    expect(res.items).toEqual([]);
    expect(formatSuche(res, { ...base, offset: 50 })).toContain('keine Treffer ab offset=50');
  });

  it('a 500 on the first page is a real error', async () => {
    const { client } = quickClient(() => new Response('boom', { status: 500 }));
    await expect(suche(client, base)).rejects.toThrow(/did not answer successfully/);
  });

  it('an unexpected answer is reported, not guessed at', async () => {
    const { client } = quickClient(() => json({ nothing: 'here' }));
    await expect(suche(client, base)).rejects.toThrow(/Unexpected response shape/);
  });
});

describe('speaker filter', () => {
  it('keeps only speeches of that person, ignoring case and umlauts', async () => {
    const { client } = quickClient(() => json(fixtureText('search-reden-staatsbesuch.json')));
    const res = await suche(client, { ...base, redner: 'fuerst' });
    // "fürst" folds to "furst", not "fuerst" - no hit; the spelling with the umlaut works
    expect(res.total).toBe(0);
    const res2 = await suche(client, { ...base, redner: 'Fürst' });
    expect(res2.total).toBeGreaterThan(0);
    expect(res2.items.every((i) => i.rede!.redner!.includes('Fürst'))).toBe(true);
  });

  it('says how many hits were looked at and that more exist', async () => {
    const { client } = quickClient(() => json(fixtureText('search-reden-staatsbesuch.json')));
    const res = await suche(client, { ...base, redner: 'Fürst' });
    expect(res.scanned).toBe(6);
    expect(res.serverTotal).toBe(13);
    expect(res.complete).toBe(false);
    const text = formatSuche(res, { ...base, redner: 'Fürst' });
    expect(text).toContain('unter den 6 geprüften');
    expect(text).toContain('Weitere Treffer wurden nicht geprüft');
  });

  it('explains when nobody of that name spoke', async () => {
    const { client } = quickClient(() => json(fixtureText('search-reden-staatsbesuch.json')));
    const res = await suche(client, { ...base, redner: 'Niemand' });
    expect(res.total).toBe(0);
    expect(formatSuche(res, { ...base, redner: 'Niemand' })).toContain('keiner von "Niemand"');
  });

  it('scans at most six pages', async () => {
    const full = {
      count: 5000,
      rows: Array.from({ length: 50 }, (_, i) => ({ title: `Teil des Protokolls: Anna Muster ${i}`, link: '/x', item_type: 'x' })),
    };
    const { client, calls } = quickClient(() => json(full));
    const res = await suche(client, { ...base, redner: 'Nobody' });
    expect(calls).toHaveLength(6);
    expect(res.scanned).toBe(300);
    expect(res.complete).toBe(false);
  });

  it('stops scanning as soon as enough speeches are found', async () => {
    const full = {
      count: 5000,
      rows: Array.from({ length: 50 }, (_, i) => ({ title: `Teil des Protokolls: Anna Muster ${i}`, link: '/x', item_type: 'x' })),
    };
    const { client, calls } = quickClient(() => json(full));
    const res = await suche(client, { ...base, redner: 'Muster', limit: 10 });
    expect(calls).toHaveLength(1);
    expect(res.items).toHaveLength(10);
  });
});

describe('formatSuche', () => {
  it('lists speeches with the exact arguments for parl_rede', async () => {
    const { client } = quickClient(() => json(fixtureText('search-reden-phrase.json')));
    const q: SucheQuery = { ...base, suche: 'Ich rede vom Staatsbesuch', modus: 'phrase', gp: 'XXVIII' };
    const text = formatSuche(await suche(client, q), q);
    expect(text).toContain(
      'Suche "Ich rede vom Staatsbesuch" (genaue Wortfolge; Reden im Plenarprotokoll, XXVIII. GP): 1 Treffer, angezeigt 1–1.',
    );
    expect(text).toContain('2025-06-16 · Herbert Kickl (FPÖ)');
    expect(text).toContain('Wortlaut: parl_rede gremium=NR gp=XXVIII nummer=30 rede=801352');
    expect(text).toContain('https://www.parlament.gv.at/dokument/XXVIII/NRSITZ/30/A_-_11_12_46_00801352.html');
    expect(text).toContain('vor dem Zitieren den Wortlaut mit parl_rede lesen');
  });

  it('Bundesrat speeches name no legislative period', async () => {
    const { client } = quickClient(() => json(fixtureText('search-reden-bundesrat.json')));
    const text = formatSuche(await suche(client, { ...base, gremium: 'BR' }), { ...base, gremium: 'BR' });
    expect(text).toMatch(/Wortlaut: parl_rede gremium=BR nummer=99\d rede=\d+/);
    expect(text).not.toMatch(/gremium=BR gp=/);
  });

  it('lists items with the arguments for parl_gegenstand', async () => {
    const { client } = quickClient(() => json(fixtureText('search-gegenstaende-klima.json')));
    const q: SucheQuery = { ...base, bereich: 'gegenstaende', nurTitel: true };
    const text = formatSuche(await suche(client, q), q);
    expect(text).toContain('Details: parl_gegenstand gp=XXVIII zitation="5017/J"');
    expect(text).toContain('nur Titel');
  });

  it('says that nothing was found and what to try', async () => {
    const { client } = quickClient(() => json(fixtureText('search-empty.json')));
    const text = formatSuche(await suche(client, base), base);
    expect(text).toContain('keine Treffer');
    expect(text).toContain('modus="beliebig"');
  });

  it('points to the next page', async () => {
    const { client } = quickClient(() => json(fixtureText('search-reden-bundesrat.json')));
    const q: SucheQuery = { ...base, gremium: 'BR', limit: 4 };
    expect(formatSuche(await suche(client, q), q)).toContain('Weitere mit offset=4.');
  });
});

describe('parl_suche over MCP', () => {
  async function connect(handler: (url: string, init: RequestInit) => Response) {
    const { client: parl, fetchImpl } = clientWith(handler);
    const server = createServer(parl);
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(b);
    const client = new Client({ name: 'test', version: '0' });
    await client.connect(a);
    return { client, fetchImpl };
  }
  const call = async (client: Client, args: Record<string, unknown>) => {
    const res = await client.callTool({ name: 'parl_suche', arguments: args });
    return {
      text: (res.content as Array<{ text: string }>)[0]!.text,
      isError: Boolean(res.isError),
      structured: res.structuredContent as any,
    };
  };

  it('finds speeches and returns structured hits that name the parl_rede arguments', async () => {
    const { client, fetchImpl } = await connect(() => json(fixtureText('search-reden-phrase.json')));
    const res = await call(client, { suche: 'Ich rede vom Staatsbesuch', modus: 'phrase' });
    expect(res.isError).toBe(false);
    expect(res.structured.total).toBe(1);
    expect(res.structured.items[0].rede).toMatchObject({ gremium: 'NR', gp: 'XXVIII', sitzung: 30, rede: 801352 });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({
      's.sm.query': 'Ich rede vom Staatsbesuch',
      searchType: ['phrase'],
      category: ['Protokolle'],
    });
  });

  it('turns a number into the legislative-period filter and dates into the range', async () => {
    const { client, fetchImpl } = await connect(() => json(fixtureText('search-reden-staatsbesuch.json')));
    await call(client, { suche: 'Staatsbesuch', gp: 28, von: '2025-06-01', bis: '2025-06-30', gremium: 'NR' });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({
      gp_liste: ['XXVIII'],
      gremium: ['Nationalrat'],
      date_range: ['2025-06-01T00:00:00.000Z', '2025-06-30T23:59:00.000Z'],
    });
  });

  it.each([
    [{ suche: 'x y', von: '16.06.2025' }, 'Ungültiges Datum für von'],
    [{ suche: 'x y', bis: '2025-02-30' }, 'Ungültiges Datum für bis'],
    [{ suche: 'x y', von: '2025-07-01', bis: '2025-06-01' }, 'liegt nach'],
    [{ suche: 'x y', gp: 'ABC' }, 'Gesetzgebungsperiode'],
  ])('%j is explained before any request', async (args, message) => {
    const { client, fetchImpl } = await connect(() => json({}));
    const res = await call(client, args);
    expect(res.isError).toBe(true);
    expect(res.text).toContain(message);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    { suche: 'a' },
    { suche: 'x y', limit: 0 },
    { suche: 'x y', limit: 51 },
    { suche: 'x y', offset: 10000 },
    { suche: 'x y', bereich: 'alle' },
    { suche: 'x y', modus: 'regex' },
  ])('%j is refused by the schema', async (args) => {
    const { client, fetchImpl } = await connect(() => json({}));
    const res = await client.callTool({ name: 'parl_suche', arguments: args }).catch(() => ({ isError: true }));
    expect(res.isError).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('reports a Parliament error as a tool error', async () => {
    const { client } = await connect(() => new Response('nope', { status: 404 }));
    const res = await call(client, { suche: 'Staatsbesuch' });
    expect(res.isError).toBe(true);
    expect(res.text).toContain('Das Parlament hat nicht geantwortet');
  });

  it('offers the fact-check prompt with the tools in the right order', async () => {
    const { client } = await connect(() => json({}));
    const p = await client.getPrompt({ name: 'faktencheck', arguments: { aussage: 'Kickl sagte, X sei Y', redner: 'Kickl' } });
    const text = (p.messages[0]!.content as { text: string }).text;
    for (const needle of [
      'parl_suche',
      'modus="phrase"',
      'parl_rede',
      'parl_beschluesse',
      'redner="Kickl"',
      'Kickl sagte, X sei Y',
      'widerlegt',
      'nicht autorisiert',
    ]) {
      expect(text).toContain(needle);
    }
    expect(text.indexOf('parl_suche')).toBeLessThan(text.indexOf('parl_rede'));
    await expect(client.getPrompt({ name: 'faktencheck', arguments: {} })).rejects.toThrow();
  });
});
