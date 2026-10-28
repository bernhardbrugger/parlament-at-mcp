import { describe, expect, it } from 'vitest';
import type { Person } from '../src/tools/abgeordnete.js';
import { formatPerson, formatReden, parseReden, resolvePerson, type RedeItem } from '../src/tools/person.js';
import type { FilterResponse, PersonResponse } from '../src/types.js';
import { clientWith, json } from './helpers.js';

const personHeader = ['Name', 'pad_intern', 'persart', 'geschl', 'Funktion', 'portrait'].map((label, i) => ({ rnr: i + 1, label }));

/** A tiny Parliament: persons list plus the two "current members" lists. `current` are the pad_intern of sitting NR members. */
function parliament(names: Array<[string, number]>, current: number[] = []) {
  const persons = names.map(([name, pad]) => [name, pad, '["NR"]', 'M', 'Abgeordneter', null]);
  const nrHeader = ['Name', 'Klub', 'Wahlkreis', 'Bundesland', 'link'].map((label) => ({ label }));
  const nrRows = current.map((pad) => ['x', 'SPÖ', '9 Wien', null, `/person/${pad}`]);
  return clientWith((url) => {
    if (url.includes('/filter/data/10400')) return json({ pages: 1, count: persons.length, header: personHeader, rows: persons });
    if (url.includes('WFW_002')) return json({ pages: 1, count: nrRows.length, header: nrHeader, rows: nrRows });
    return json({ pages: 1, count: 0, header: [{ rnr: 1, label: 'pad_intern' }], rows: [] });
  }).client;
}

describe('resolvePerson', () => {
  it('finds a person by pad_intern and says so when there is none', async () => {
    const client = parliament([['Kickl Herbert', 91034]]);
    expect(await resolvePerson(client, { pad_intern: 91034 })).toMatchObject({ person: { name: 'Kickl Herbert' } });
    expect(await resolvePerson(client, { pad_intern: 1 })).toEqual({ error: expect.stringContaining('Keine Person mit pad_intern 1') });
  });

  it('asks for an id or a name', async () => {
    expect(await resolvePerson(parliament([]), {})).toEqual({ error: 'Bitte pad_intern oder name angeben.' });
  });

  it('takes a unique name match, in any order and ignoring titles', async () => {
    const client = parliament([
      ['Kickl Herbert', 1],
      ['Babler Andreas, Dr.', 2],
    ]);
    expect(await resolvePerson(client, { name: 'andreas babler' })).toMatchObject({ person: { padIntern: 2 } });
  });

  it('reports an unknown name with a hint', async () => {
    const res = await resolvePerson(parliament([['Kickl Herbert', 1]]), { name: 'Niemand' });
    expect(res).toEqual({ error: expect.stringContaining('Keine Person zu "Niemand" gefunden') });
  });

  it('prefers the one sitting member over namesakes from the past', async () => {
    const client = parliament(
      [
        ['Müller Hans', 10],
        ['Müller Hans Peter', 11],
      ],
      [11],
    );
    expect(await resolvePerson(client, { name: 'Müller' })).toMatchObject({ person: { padIntern: 11 } });
  });

  it('does not guess between several candidates and lists them', async () => {
    const client = parliament([
      ['Huber Anna', 1],
      ['Huber Berta', 2],
    ]);
    const res = await resolvePerson(client, { name: 'huber' });
    expect(res).toHaveProperty('error');
    const msg = (res as { error: string }).error;
    expect(msg).toContain('nicht eindeutig (2 Treffer)');
    expect(msg).toContain('pad_intern 1');
    expect(msg).toContain('pad_intern 2');
    expect(msg).not.toContain('…');
  });

  it('shortens a long candidate list', async () => {
    const many = Array.from({ length: 12 }, (_, i): [string, number] => [`Maier Person${i}`, 100 + i]);
    const res = await resolvePerson(parliament(many), { name: 'maier' });
    const msg = (res as { error: string }).error;
    expect(msg).toContain('(12 Treffer)');
    expect(msg.match(/pad_intern/g)).toHaveLength(9); // 8 candidates + the instruction
    expect(msg.endsWith('…')).toBe(true);
  });

  it('with two sitting namesakes still asks', async () => {
    const client = parliament(
      [
        ['Maier Anna', 1],
        ['Maier Bert', 2],
      ],
      [1, 2],
    );
    expect(await resolvePerson(client, { name: 'maier' })).toHaveProperty('error');
  });
});

describe('formatPerson', () => {
  const base: Person = {
    padIntern: 7,
    name: 'Muster Max',
    funktion: null,
    gremien: [],
    geschlecht: null,
    url: 'https://www.parlament.gv.at/person/7',
    portraitUrl: null,
    aktuell: null,
  };
  const detail = (content: unknown) => ({ content }) as unknown as PersonResponse;

  it('copes with a nearly empty page', () => {
    const text = formatPerson(base, detail({}));
    expect(text).toBe(
      [
        'Muster Max',
        'Keine Funktion angegeben',
        'Derzeit nicht im Amt (laut Parlament).',
        'Quelle: https://www.parlament.gv.at/person/7',
        'Reden dieser Person: parl_reden_person.',
      ].join('\n'),
    );
  });

  it('uses the page title, the active flag and the sitting mandate', () => {
    const active = formatPerson(base, detail({ headingbox: { title_plain: 'Mag. Max Muster' }, personInfo: { aktiv: true } }));
    expect(active.split('\n')[0]).toBe('Mag. Max Muster');
    expect(active).toContain('Derzeit aktiv (laut Parlament).');
    const sitting = formatPerson(
      { ...base, funktion: 'Abgeordneter', aktuell: { gremium: 'NR', klub: 'SPÖ', wahlkreis: '9 Wien', bundesland: 'Wien' } },
      detail({ personInfo: { aktiv: false } }),
    );
    expect(sitting).toContain('Abgeordneter');
    expect(sitting).toContain('AKTUELL im Nationalrat');
    expect(sitting).not.toContain('Derzeit');
  });

  it('lists mandates and caps long lists', () => {
    const mandate = Array.from({ length: 15 }, (_, i) => ({
      bez: `Mandat ${i + 1}`,
      zeitraum: '2020 - 2024',
      aktiv: i === 0,
      wahlkreis: i === 1 ? '9 Wien' : null,
    }));
    const text = formatPerson(
      base,
      detail({
        biografie: {
          kurzbiografie: {
            gebtext: 'geb. 1970 in Wien',
            politischeFunktionen: Array.from({ length: 14 }, (_, i) => `Funktion <b>${i + 1}</b>`),
            beruflicherWerdegang: ['Jurist'],
            bildungsweg: [],
          },
          mandatefunktionen: { mandate },
          biografieStand: '01.01.2025',
        },
      }),
    );
    expect(text).toContain('geb. 1970 in Wien');
    expect(text).toContain('- Mandat 1 (2020 - 2024) · aktiv');
    expect(text).toContain('- Mandat 2 (2020 - 2024) · 9 Wien');
    expect(text).toContain('- … und 3 weitere');
    expect(text).toContain('Politische Funktionen:');
    expect(text).toContain('- Funktion 1');
    expect(text).not.toContain('<b>');
    expect(text).toContain('- … und 2 weitere');
    expect(text).toContain('Beruflicher Werdegang:');
    expect(text).not.toContain('Bildungsweg:'); // empty section is left out
    expect(text).toContain('Biografie-Stand: 01.01.2025');
  });

  it('falls back to the body name for a mandate without a title', () => {
    const text = formatPerson(base, detail({ biografie: { mandatefunktionen: { mandate: [{ gremium: 'Bundesrat' }, {}] } } }));
    expect(text).toContain('- Bundesrat');
    expect(text).toContain('- Mandat');
  });
});

describe('parseReden and formatReden', () => {
  const header = ['Sitzung', 'Rede', 'fromDate', 'col5'].map((label, i) => ({ rnr: i + 1, label }));
  const resp = (rows: unknown[][]) => ({ pages: 1, count: rows.length, header, rows }) as unknown as FilterResponse;

  it('reads the session out of the link and skips cells without one', () => {
    const items = parseReden(
      resp([
        ['<a href="/sitzung/XXVIII/NRSITZ/30">30</a>', 'Budget', '2025-06-16T09:00:00', '<a href="/dokument/x.html">p</a>'],
        ['<a href="/sitzung/BR/BRSITZ/7">7</a>', '', '2024-01-02', '<a href="https://www.parlament.gv.at/d.html">p</a>'],
        ['kein Link', 'Weg', '2025-01-01', null],
        [null, 'Weg', '2025-01-01', null],
        ['<a href="/sitzung/XXVII/NRSITZ/5">5</a>', 'Ohne Datum', 'morgen', 5],
      ]),
    );
    expect(items).toEqual([
      {
        gremium: 'NR',
        gp: 'XXVIII',
        sitzung: 30,
        datum: '2025-06-16',
        thema: 'Budget',
        protokollUrl: 'https://www.parlament.gv.at/dokument/x.html',
      },
      {
        gremium: 'BR',
        gp: 'BR',
        sitzung: 7,
        datum: '2024-01-02',
        thema: '(ohne Titel)',
        protokollUrl: 'https://www.parlament.gv.at/d.html',
      },
      { gremium: 'NR', gp: 'XXVII', sitzung: 5, datum: null, thema: 'Ohne Datum', protokollUrl: null },
    ]);
  });

  const who = { name: 'Kickl Herbert' } as Person;
  const item = (over: Partial<RedeItem> = {}): RedeItem => ({
    gremium: 'NR',
    gp: 'XXVIII',
    sitzung: 30,
    datum: '2025-06-16',
    thema: 'Budget',
    protokollUrl: 'https://www.parlament.gv.at/p',
    ...over,
  });

  it('explains empty results and offsets past the end', () => {
    expect(formatReden(who, { total: 0, items: [] }, 0)).toContain('Keine Reden von Kickl Herbert');
    expect(formatReden(who, { total: 40, items: [] }, 60)).toBe('Keine Treffer ab offset=60; es gibt insgesamt 40.');
  });

  it('tells the next call exactly which arguments to use', () => {
    const text = formatReden(
      who,
      { total: 3, items: [item(), item({ gremium: 'BR', gp: 'BR', sitzung: 7, datum: null, protokollUrl: null })] },
      0,
    );
    expect(text).toContain('3 Reden von Kickl Herbert, neueste zuerst, angezeigt 1–2. Weitere mit offset=2.');
    expect(text).toContain('2025-06-16 · 30. Sitzung des Nationalrats (XXVIII. GP) · Budget');
    expect(text).toContain('Protokoll: https://www.parlament.gv.at/p');
    expect(text).toContain('parl_sitzung gremium=NR gp=XXVIII nummer=30 redner="Kickl"');
    expect(text).toContain('? · 7. Sitzung des Bundesrats');
    expect(text).toContain('parl_sitzung gremium=BR nummer=7 redner="Kickl"');
    expect(text).not.toContain('gremium=BR gp=');
  });

  it('does not offer more when the page is the last one', () => {
    expect(formatReden(who, { total: 1, items: [item()] }, 0)).not.toContain('Weitere mit offset');
  });
});
