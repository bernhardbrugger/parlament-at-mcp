import { describe, expect, it, vi } from 'vitest';
import { ParlamentClient } from '../src/client.js';
import {
  describeCurrent,
  formatPersons,
  loadPersons,
  searchPersons,
  type CurrentInfo,
  type Person,
  type PersonQuery,
} from '../src/tools/abgeordnete.js';
import { json } from './helpers.js';

function person(over: Partial<Person> & { padIntern: number; name: string }): Person {
  return {
    funktion: null,
    gremien: [],
    geschlecht: null,
    url: `https://www.parlament.gv.at/person/${over.padIntern}`,
    portraitUrl: null,
    aktuell: null,
    ...over,
  };
}

const wien: CurrentInfo = { gremium: 'NR', klub: 'SPÖ', wahlkreis: '9 Wien', bundesland: 'Wien' };
const ooe: CurrentInfo = { gremium: 'NR', klub: 'FPÖ', wahlkreis: '4D Traunviertel', bundesland: 'Oberösterreich' };
const br: CurrentInfo = { gremium: 'BR', klub: 'ÖVP', wahlkreis: null, bundesland: 'Tirol' };

const people: Person[] = [
  person({ padIntern: 1, name: 'Müller Anna, Mag.', funktion: 'Abgeordnete zum Nationalrat', gremien: ['NR'], aktuell: wien }),
  person({ padIntern: 2, name: 'Mueller Bernd', funktion: 'Klubobmann', gremien: ['NR', 'BR'], aktuell: ooe }),
  person({ padIntern: 3, name: 'Öllinger Karl', funktion: 'Mitglied des Bundesrates', gremien: ['BR'], aktuell: br }),
  person({ padIntern: 4, name: 'Straßer Hans', funktion: 'Bundesminister a. D.', gremien: ['BuREG'] }),
  person({ padIntern: 5, name: 'Ohne Funktion Eva' }),
];

const q = (over: Partial<PersonQuery> = {}): PersonQuery => ({ limit: 20, offset: 0, ...over });
const ids = (r: { items: Person[] }) => r.items.map((p) => p.padIntern);

describe('searchPersons', () => {
  it('without a filter returns everybody', () => {
    expect(searchPersons(people, q()).total).toBe(5);
  });

  it('matches every name part in any order, ignoring case and umlauts', () => {
    expect(ids(searchPersons(people, q({ name: 'anna müller' })))).toEqual([1]);
    expect(ids(searchPersons(people, q({ name: 'MULLER' })))).toEqual([1]); // ü folds to u
    expect(ids(searchPersons(people, q({ name: 'strasser' })))).toEqual([4]); // ß folds to ss
    expect(ids(searchPersons(people, q({ name: 'oellinger' })))).toEqual([]); // ö is not oe
    expect(searchPersons(people, q({ name: '   ' })).total).toBe(5);
  });

  it('filters by function text', () => {
    expect(ids(searchPersons(people, q({ funktion: 'bundesminister' })))).toEqual([4]);
    expect(ids(searchPersons(people, q({ funktion: 'nationalrat' })))).toEqual([1]);
    expect(searchPersons(people, q({ funktion: 'gibt es nicht' })).total).toBe(0);
  });

  it('filters by body, case-insensitive and exact', () => {
    expect(ids(searchPersons(people, q({ gremium: 'br' })))).toEqual([2, 3]);
    expect(ids(searchPersons(people, q({ gremium: ' BuREG ' })))).toEqual([4]);
    expect(searchPersons(people, q({ gremium: 'N' })).total).toBe(0);
  });

  it('nur_aktuell, klub and bundesland only look at current members', () => {
    expect(ids(searchPersons(people, q({ nurAktuell: true })))).toEqual([1, 2, 3]);
    expect(ids(searchPersons(people, q({ klub: 'spö' })))).toEqual([1]);
    expect(ids(searchPersons(people, q({ klub: 'SPO' })))).toEqual([1]);
    expect(ids(searchPersons(people, q({ klub: 'p' })))).toEqual([1, 2, 3]); // partial match works
    expect(ids(searchPersons(people, q({ bundesland: 'oberösterreich' })))).toEqual([2]);
    expect(ids(searchPersons(people, q({ bundesland: 'tirol' })))).toEqual([3]);
    expect(searchPersons(people, q({ klub: 'NEOS' })).total).toBe(0);
  });

  it('combines filters with "and"', () => {
    expect(ids(searchPersons(people, q({ gremium: 'NR', klub: 'FPÖ' })))).toEqual([2]);
    expect(searchPersons(people, q({ gremium: 'BuREG', nurAktuell: true })).total).toBe(0);
  });

  it('pages: total counts all hits, items only the requested slice', () => {
    const r = searchPersons(people, q({ limit: 2, offset: 1 }));
    expect(r.total).toBe(5);
    expect(ids(r)).toEqual([2, 3]);
    expect(searchPersons(people, q({ offset: 99 }))).toEqual({ total: 5, items: [] });
  });
});

describe('describeCurrent', () => {
  it('names the body and the club', () => {
    expect(describeCurrent(wien)).toBe('AKTUELL im Nationalrat · Klub SPÖ · Wahlkreis 9 Wien');
  });

  it('adds the Bundesland only when the Wahlkreis does not already say it', () => {
    expect(describeCurrent(ooe)).toBe('AKTUELL im Nationalrat · Klub FPÖ · Wahlkreis 4D Traunviertel · Oberösterreich');
    expect(describeCurrent(br)).toBe('AKTUELL im Bundesrat · Klub ÖVP · Tirol');
  });

  it('copes with missing parts', () => {
    expect(describeCurrent({ gremium: 'BR', klub: null, wahlkreis: null, bundesland: null })).toBe('AKTUELL im Bundesrat');
  });
});

describe('formatPersons', () => {
  it('explains an empty result with search tips', () => {
    expect(formatPersons({ total: 0, items: [] }, q())).toContain('Keine Personen gefunden');
  });

  it('shows function, bodies, the current mandate and the id to use next', () => {
    const text = formatPersons({ total: 2, items: [people[1]!, people[4]!] }, q());
    expect(text).toContain('- Mueller Bernd — Klubobmann [NR, BR]');
    expect(text).toContain('AKTUELL im Nationalrat · Klub FPÖ');
    expect(text).toContain('(pad_intern 2)');
    expect(text).toContain('- Ohne Funktion Eva — keine Funktion angegeben');
    expect(text).not.toContain('Weitere Treffer');
  });

  it('points to the next page when there is one', () => {
    const text = formatPersons({ total: 9, items: [people[0]!, people[1]!] }, q({ offset: 3, limit: 2 }));
    expect(text).toContain('Weitere Treffer mit offset=5.');
    expect(text).toContain('4–5');
  });
});

describe('loadPersons with odd rows and a failing "current" list', () => {
  const header = [
    { rnr: 1, label: 'Name' },
    { rnr: 2, label: 'pad_intern' },
    { rnr: 3, label: 'persart' },
    { rnr: 4, label: 'geschl' },
    { rnr: 5, label: 'Funktion' },
    { rnr: 6, label: 'portrait' },
  ];
  const rows = [
    ['Gut Anna', 10, '["NR","NR","BR"]', 'W', 'Abgeordnete<sup>x</sup>', '/img/10.jpg'],
    ['Kaputt Bernd', 'abc', '["NR"]', 'M', null, null],
    ['', 12, '[]', 'M', null, null],
    ['Seltsam Carl', 13, 'kein json', 'X', 5, ''],
    ['Objekt Dora', 14, '{"a":1}', 'W', null, null],
  ];

  function client() {
    return new ParlamentClient({
      delayMs: 0,
      retries: 0,
      sleep: async () => {},
      fetchImpl: (async (url: string) => {
        if (url.includes('/filter/data/10400')) return json({ pages: 1, count: rows.length, header, rows });
        return new Response('boom', { status: 500 });
      }) as unknown as typeof fetch,
    });
  }

  it('keeps usable rows, repairs what it can and survives the failing current list', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const list = await loadPersons(client());
      expect(list.map((p) => p.padIntern)).toEqual([10, 13, 14]);
      const [anna, carl, dora] = list as [Person, Person, Person];
      expect(anna.gremien).toEqual(['NR', 'BR']); // duplicates removed
      expect(anna.funktion).toBe('Abgeordnetex');
      expect(anna.geschlecht).toBe('W');
      expect(anna.portraitUrl).toBe('https://www.parlament.gv.at/img/10.jpg');
      expect(anna.aktuell).toBeNull();
      expect(carl).toMatchObject({ gremien: [], geschlecht: null, funktion: null, portraitUrl: null });
      expect(dora.gremien).toEqual([]);
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('current members unavailable'));
    } finally {
      spy.mockRestore();
    }
  });
});
