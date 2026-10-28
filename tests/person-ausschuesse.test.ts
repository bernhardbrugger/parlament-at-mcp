import { describe, expect, it } from 'vitest';
import { ParlamentClient } from '../src/client.js';
import { loadPersons, type Person } from '../src/tools/abgeordnete.js';
import { filterAusschuesse, formatAusschussDetail, formatAusschussListe, parseAusschuesse } from '../src/tools/ausschuesse.js';
import { formatPerson, formatReden, parseReden, resolvePerson, searchReden } from '../src/tools/person.js';
import { detailSchema, personSchema } from '../src/types.js';
import { clientWith, fixture, fixtureText, json } from './helpers.js';

async function persons(): Promise<{ client: ParlamentClient; all: Person[] }> {
  const client = new ParlamentClient({
    delayMs: 0,
    retries: 0,
    sleep: async () => {},
    fetchImpl: (async (url: string) => {
      if (url.includes('/filter/data/10400')) return json(fixtureText('persons-10400.json'));
      if (url.includes('FBEZ=WFW_002')) return json(fixtureText('members-wfw002-nr.json'));
      if (url.includes('FBEZ=WFW_005')) return json(fixtureText('members-wfw005-br.json'));
      throw new Error(`unexpected request ${url}`);
    }) as unknown as typeof fetch,
  });
  return { client, all: await loadPersons(client) };
}

describe('resolvePerson', () => {
  it('finds a person by pad_intern or by a unique name', async () => {
    const { client } = await persons();
    expect(await resolvePerson(client, { pad_intern: 91034 })).toMatchObject({ person: { name: expect.stringContaining('Rendi-Wagner') } });
    expect(await resolvePerson(client, { name: 'kickl' })).toMatchObject({ person: { padIntern: 35520 } });
    expect(await resolvePerson(client, { name: 'Ingo Appe' })).toMatchObject({ person: { padIntern: 3538 } });
  });

  it('lists candidates instead of guessing when a name is ambiguous', async () => {
    const { client } = await persons();
    const r = await resolvePerson(client, { name: 'Androsch' });
    expect(r).toHaveProperty('error');
    const text = (r as { error: string }).error;
    expect(text).toContain('nicht eindeutig (2 Treffer)');
    expect(text).toContain('pad_intern 18');
    expect(text).toContain('pad_intern 73000');
  });

  it('prefers the single current member among several namesakes', async () => {
    const nr = fixture('members-wfw002-nr.json');
    // make Maurice Androsch (pad 73000) a current member; his namesake Hannes (pad 18) is not
    nr.rows.push([
      'Androsch Maurice, Ing.',
      '<span title="NEOS Parlamentsklub">NEOS</span>',
      '9 Wien',
      '<span title="Wien">W</span>',
      'Androsch',
      null,
      null,
      null,
      null,
      null,
      null,
      '/person/73000',
    ]);
    const client = new ParlamentClient({
      delayMs: 0,
      retries: 0,
      sleep: async () => {},
      fetchImpl: (async (url: string) => {
        if (url.includes('/filter/data/10400')) return json(fixtureText('persons-10400.json'));
        if (url.includes('FBEZ=WFW_002')) return json(nr);
        if (url.includes('FBEZ=WFW_005')) return json(fixtureText('members-wfw005-br.json'));
        throw new Error(`unexpected request ${url}`);
      }) as unknown as typeof fetch,
    });
    expect(await resolvePerson(client, { name: 'Androsch' })).toMatchObject({ person: { padIntern: 73000 } });
  });

  it('keeps asking when several namesakes are not current', async () => {
    const { client } = await persons();
    expect(await resolvePerson(client, { name: 'Aigner' })).toHaveProperty('error');
  });

  it('explains missing or unknown input', async () => {
    const { client } = await persons();
    expect(await resolvePerson(client, {})).toEqual({ error: 'Bitte pad_intern oder name angeben.' });
    expect(await resolvePerson(client, { pad_intern: 1 })).toMatchObject({
      error: expect.stringContaining('Keine Person mit pad_intern 1'),
    });
    expect(await resolvePerson(client, { name: 'Zzzzzz' })).toMatchObject({ error: expect.stringContaining('Keine Person zu "Zzzzzz"') });
  });
});

describe('person detail (real fixture)', () => {
  const detail = fixture('person-91034.json');

  it('validates against the schema', () => {
    expect(personSchema.safeParse(detail).success).toBe(true);
  });

  it('formats mandates, political functions, career and education', async () => {
    const { all } = await persons();
    const rw = all.find((p) => p.padIntern === 91034)!;
    const text = formatPerson(rw, personSchema.parse(detail));
    expect(text).toContain('Dr. Pamela Rendi-Wagner, MSc');
    expect(text).toContain('Derzeit nicht im Amt (laut Parlament).');
    expect(text).toContain('Geb.: 07.05.1971, Wien');
    expect(text).toContain('Abgeordnete zum Nationalrat (XXVI.-XXVII. GP), SPÖ (09.11.2017-30.06.2023)');
    expect(text).toContain('Bundesministerin für Gesundheit und Frauen (08.03.2017-18.12.2017)');
    expect(text).toContain('Politische Funktionen:');
    expect(text).toContain('Bundesparteivorsitzende der SPÖ');
    expect(text).toContain('Beruflicher Werdegang:');
    expect(text).toContain('Bildungsweg:');
    expect(text).toContain('Biografie-Stand: 05.09.2023');
    expect(text).toContain('Quelle: https://www.parlament.gv.at/person/91034');
    expect(text).not.toMatch(/<[a-z]/);
  });

  it('prefers the current-member line over the generic flag', async () => {
    const { all } = await persons();
    const rw = {
      ...all.find((p) => p.padIntern === 91034)!,
      aktuell: { gremium: 'NR' as const, klub: 'SPÖ', wahlkreis: 'B Bundeswahlvorschlag', bundesland: null },
    };
    const text = formatPerson(rw, personSchema.parse(detail));
    expect(text).toContain('AKTUELL im Nationalrat · Klub SPÖ');
    expect(text).not.toContain('Derzeit nicht im Amt');
  });

  it('tolerates a nearly empty page', async () => {
    const { all } = await persons();
    const text = formatPerson(all[0]!, personSchema.parse({ content: {} }));
    expect(text).toContain(all[0]!.name);
    expect(text).toContain('Quelle:');
  });
});

describe('speeches of a person (list 251, real fixture)', () => {
  const resp = fixture('person-reden-251.json');

  it('parses session, date, topic and protocol link', () => {
    const [first, second] = parseReden(resp);
    expect(parseReden(resp)).toHaveLength(5);
    expect(first).toEqual({
      gremium: 'NR',
      gp: 'XXVII',
      sitzung: 217,
      datum: '2023-06-01',
      thema: 'Bundes-Energieeffizienzgesetz',
      protokollUrl: 'https://www.parlament.gv.at/dokument/XXVII/NRSITZ/217/fnameorig_1637108.html#RU_297804',
    });
    expect(second!.thema).toContain('Dringlicher Antrag der Abg. Rendi-Wagner');
  });

  it('formats a list that leads on to parl_sitzung and parl_rede', async () => {
    const { all } = await persons();
    const rw = all.find((p) => p.padIntern === 91034)!;
    const text = formatReden(rw, { total: 129, items: parseReden(resp) }, 0);
    expect(text).toContain('129 Reden von Rendi-Wagner Pamela, Dr., MSc, neueste zuerst, angezeigt 1–5. Weitere mit offset=5.');
    expect(text).toContain('2023-06-01 · 217. Sitzung des Nationalrats (XXVII. GP) · Bundes-Energieeffizienzgesetz');
    expect(text).toContain('parl_sitzung gremium=NR gp=XXVII nummer=217 redner="Rendi-Wagner" → rede-Nummer → parl_rede');
  });

  it('says so when there are no speeches or the offset is too far', async () => {
    const { all } = await persons();
    expect(formatReden(all[0]!, { total: 0, items: [] }, 0)).toContain('Keine Reden von');
    expect(formatReden(all[0]!, { total: 129, items: [] }, 500)).toContain('insgesamt 129');
  });

  it('queries list 251 for one person, newest first', async () => {
    const { client, fetchImpl } = clientWith(() => json(fixtureText('person-reden-251.json')));
    const res = await searchReden(client, 91034, 0, 3);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/Filter/api/filter/data/251?');
    expect(url).toContain('ascDesc=DESC');
    expect(JSON.parse(init.body as string)).toEqual({ PAD_INTERN: ['91034'] });
    expect(res.total).toBe(129);
    expect(res.items).toHaveLength(3);
  });
});

describe('committees (real fixtures)', () => {
  const list = fixture('committees-wfp009-nr-xxviii.json');
  const items = parseAusschuesse(list);

  it('parses the committee list with validated detail paths', () => {
    expect(items).toHaveLength(8);
    expect(items[0]).toEqual({
      name: 'Pilnacek-Untersuchungsausschuss eingesetzt am 22.10.2025',
      seit: '22.10.25',
      path: '/ausschuss/XXVIII/A-USA/2/00944',
      url: 'https://www.parlament.gv.at/ausschuss/XXVIII/A-USA/2/00944',
    });
    expect(items[1]!.path).toBe('/ausschuss/XXVIII/A-AS/1/00917');
  });

  it('drops links that are not plain committee paths', () => {
    const bad = JSON.parse(JSON.stringify(list));
    bad.rows[0][7] = '/ausschuss/XXVIII/../../etc/passwd';
    bad.rows[1][7] = 'https://evil.example/ausschuss/XXVIII/A-AS/1/00917';
    const parsed = parseAusschuesse(bad);
    expect(parsed[0]!.path).toBeNull();
    expect(parsed[1]!.path).toBeNull();
    expect(parsed[2]!.path).toBe('/ausschuss/XXVIII/A-AU/1/00918');
  });

  it('filters by name ignoring case and umlauts', () => {
    expect(filterAusschuesse(items, 'arbeit').map((i) => i.name)).toEqual(['Ausschuss für Arbeit und Soziales']);
    expect(filterAusschuesse(items, 'AUSSENPOLITISCH')).toHaveLength(1);
    expect(filterAusschuesse(items, 'zzz')).toEqual([]);
    expect(filterAusschuesse(items)).toHaveLength(8);
  });

  it('formats the list and points to the detail mode', () => {
    const text = formatAusschussListe(items, 'XXVIII');
    expect(text).toContain('8 Ausschüsse der XXVIII. GP:');
    expect(text).toContain('Budgetausschuss (seit 24.10.24)');
    expect(text).toContain('suche=');
    expect(formatAusschussListe([], undefined)).toContain('Keine Ausschüsse gefunden');
  });

  it('formats a committee detail page with chairs, agendas and assigned items', () => {
    const detail = detailSchema.parse(fixture('detail-committee-as.json'));
    const text = formatAusschussDetail(items[1]!, detail);
    expect(text).toContain('Ausschuss für Arbeit und Soziales (eingesetzt 26.02.25)');
    expect(text).toContain('Vorsitz:');
    expect(text).toContain('Obmann: Josef Muchitsch — https://www.parlament.gv.at/person/35497');
    expect(text).toContain('Obmannstellvertreterin: Dr. Dagmar Belakowitsch');
    expect(text).toContain(
      'Tagesordnung der 11. Sitzung vom 03.11.2026: https://www.parlament.gv.at/dokument/XXVIII/A-AS/1/00917/TO_16952398.html',
    );
    expect(text).toContain('Zugewiesene Gegenstände (die 3 ersten von 3)');
    expect(text).toContain('Quelle: https://www.parlament.gv.at/ausschuss/XXVIII/A-AS/1/00917');
  });
});

describe('schema drift', () => {
  it('a malformed optional block disappears instead of failing the page', () => {
    const parsed = detailSchema.parse({
      content: { title: 'x', phase: [{ stages: 'not a list' }], names: 'broken', status: 42, vote: { text: 7 }, topics: { data: 'nope' } },
    });
    expect(parsed.content.title).toBe('x');
    expect(parsed.content.names).toBeUndefined();
    expect(parsed.content.status).toBeUndefined();
    expect(parsed.content.vote).toBeUndefined();
    expect(parsed.content.topics).toBeUndefined();
  });

  it('a committee-style phase without a name is accepted', () => {
    const parsed = detailSchema.parse({ content: { phase: [{ stages: [{ date: '01.01.2026', text: 'x' }] }] } });
    expect(parsed.content.phase).toHaveLength(1);
  });
});
