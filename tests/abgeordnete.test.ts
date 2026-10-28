import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ParlamentClient } from '../src/client.js';
import { cleanText, fold, formatPersons, loadPersons, searchPersons } from '../src/tools/abgeordnete.js';
import { rowsToObjects, filterResponseSchema } from '../src/types.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/persons-10400.json', import.meta.url), 'utf8'));

function clientWithFixture() {
  let calls = 0;
  const client = new ParlamentClient({
    delayMs: 0,
    fetchImpl: (async () => {
      calls++;
      return new Response(JSON.stringify(fixture), { status: 200 });
    }) as unknown as typeof fetch,
  });
  return { client, calls: () => calls };
}

describe('real API fixture (list 10400, trimmed)', () => {
  it('matches the envelope schema', () => {
    expect(filterResponseSchema.safeParse(fixture).success).toBe(true);
  });

  it('maps positional rows to labelled objects', () => {
    const rows = rowsToObjects(fixture);
    expect(rows[0]).toMatchObject({ Name: 'Achatz Karin', pad_intern: 576, geschl: 'W', link: '/person/576' });
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

describe('loadPersons', () => {
  it('normalises the fixture and caches the list', async () => {
    const { client, calls } = clientWithFixture();
    const persons = await loadPersons(client);
    await loadPersons(client);
    expect(calls()).toBe(1);
    expect(persons).toHaveLength(fixture.rows.length);
    const arpa = persons.find((p) => p.padIntern === 24110)!;
    expect(arpa.name).toBe('Arpa Claudia, Mag.a'); // <sup> stripped
    expect(arpa.gremien).toEqual(['BR', 'MPO']);
    expect(arpa.url).toBe('https://www.parlament.gv.at/person/24110');
    expect(arpa.portraitUrl).toMatch(/^https:\/\/www\.parlament\.gv\.at\/dokument\/bild\//);
    expect(arpa.geschlecht).toBe('W');
  });
});

describe('searchPersons', () => {
  it('finds by name parts regardless of order, case and diacritics', async () => {
    const all = await loadPersons(clientWithFixture().client);
    const q = { limit: 20, offset: 0 };
    expect(searchPersons(all, { ...q, name: 'rendi wagner' }).items.map((p) => p.padIntern)).toEqual([91034]);
    expect(searchPersons(all, { ...q, name: 'KICKL' }).total).toBe(1);
    expect(searchPersons(all, { ...q, name: 'Appe' }).items[0]?.name).toContain('Appé');
  });

  it('filters by gremium and funktion', async () => {
    const all = await loadPersons(clientWithFixture().client);
    const q = { limit: 100, offset: 0 };
    const bureg = searchPersons(all, { ...q, gremium: 'bureg' });
    expect(bureg.total).toBeGreaterThan(3);
    expect(bureg.items.every((p) => p.gremien.includes('BuREG'))).toBe(true);
    expect(searchPersons(all, { ...q, funktion: 'volksanwalt' }).items.map((p) => p.name)).toEqual(['Achitz Bernhard, Mag.']);
  });

  it('paginates', async () => {
    const all = await loadPersons(clientWithFixture().client);
    const page1 = searchPersons(all, { limit: 5, offset: 0 });
    const page2 = searchPersons(all, { limit: 5, offset: 5 });
    expect(page1.total).toBe(all.length);
    expect(page1.items).toHaveLength(5);
    expect(page2.items[0]).not.toEqual(page1.items[0]);
    expect(formatPersons(page1, { limit: 5, offset: 0 })).toContain('Weitere Treffer mit offset=5');
  });

  it('explains empty results', () => {
    expect(formatPersons({ total: 0, items: [] }, { limit: 20, offset: 0 })).toContain('Keine Personen gefunden');
  });
});
