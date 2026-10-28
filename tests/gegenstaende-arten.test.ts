import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { createServer } from '../src/server.js';
import {
  ARTEN,
  buildBody,
  formatGegenstaende,
  parseGegenstaende,
  searchGegenstaende,
  type GegenstaendeQuery,
} from '../src/tools/gegenstaende.js';
import { formatGegenstand } from '../src/tools/gegenstand.js';
import { detailSchema } from '../src/types.js';
import { clientWith, fixture, fixtureText, json } from './helpers.js';

const base: GegenstaendeQuery = { gremium: 'NR', art: 'PET', limit: 15, offset: 0 };

describe('petitions, citizens’ initiatives and EU documents (real list 101 answers)', () => {
  it('knows all six kinds', () => {
    expect(Object.keys(ARTEN).sort()).toEqual(['ANTR', 'BI', 'EU', 'PET', 'RV', 'VOLKBG']);
  });

  it('sends the kind as the VHG filter', () => {
    for (const art of ['PET', 'BI', 'EU'] as const) expect(buildBody({ gremium: 'NR', art, gp: 'XXVIII' })).toMatchObject({ VHG: [art] });
  });

  it('parses petitions with their citation and link', () => {
    const items = parseGegenstaende(fixture('items-101-pet-xxviii.json'));
    expect(items).toHaveLength(4);
    expect(items[0]).toMatchObject({ zitation: '29/PET', artLang: 'Petition im Nationalrat', datum: '2026-09-29' });
    expect(items.map((i) => i.zitation)).toEqual(['29/PET', '28/PET', '27/PET', '26/PET']);
    expect(items[0]!.url).toBe('https://www.parlament.gv.at/gegenstand/XXVIII/PET/29');
    expect(items.every((i) => i.zitation.endsWith('/PET'))).toBe(true);
  });

  it('parses citizens’ initiatives', () => {
    const items = parseGegenstaende(fixture('items-101-bi-xxviii.json'));
    expect(items).toHaveLength(4);
    expect(items.every((i) => i.zitation.endsWith('/BI') && i.artLang === 'Bürgerinitiative')).toBe(true);
  });

  it('parses EU documents of several sub-types and keeps their citation', () => {
    const items = parseGegenstaende(fixture('items-101-eu-xxviii.json'));
    expect(items).toHaveLength(4);
    expect(items.every((i) => i.zitation.endsWith('/EUBTG'))).toBe(true);
    expect(items[0]!.artLang).toContain('vorbereitenden Gremien');
    expect(items[0]!.datum).toBe('2026-10-27');
  });

  it('names the kind in the headline', () => {
    const items = parseGegenstaende(fixture('items-101-pet-xxviii.json'));
    const text = formatGegenstaende({ total: 29, items }, base);
    expect(text).toContain('29 Treffer (Petition), angezeigt 1–4. Weitere mit offset=4.');
    expect(text).toContain('29/PET');
  });

  it('asks for the newest first - the list has no useful order of its own', async () => {
    const { client, fetchImpl } = clientWith(() => json(fixtureText('items-101-pet-xxviii.json')));
    await searchGegenstaende(client, { ...base, gp: 'XXVIII', limit: 3 });
    const [url] = fetchImpl.mock.calls[0] as unknown as [string];
    expect(url).toContain('sortrnr=9');
    expect(url).toContain('ascDesc=DESC');
  });
});

describe('parl_gegenstand for a petition and a citizens’ initiative (real pages)', () => {
  it('validates against the schema, including the press releases', () => {
    const pet = detailSchema.parse(fixture('detail-pet-21.json'));
    expect(pet.content.correspondence).toHaveLength(2);
    expect(pet.content.correspondence![0]).toMatchObject({ title: 'Neu im Petitionsausschuss', date: '22.07.2026' });
  });

  it('shows who handed it in, where it stands and the press releases with absolute links', () => {
    const text = formatGegenstand(detailSchema.parse(fixture('detail-pet-21.json')), '/gegenstand/XXVIII/PET/21');
    expect(text).toContain('Petition überreicht von: Klaus Mair (V)');
    expect(text).toContain('Stand: Ausschuss für Petitionen und Bürgerinitiativen: auf Tagesordnung');
    expect(text).toContain('Parlamentskorrespondenz (Pressemeldungen):');
    expect(text).toContain(
      '- 22.10.2026: Petitionsausschuss holt Einschätzungen zu Bürgeranliegen ein — https://www.parlament.gv.at/aktuelles/pk/jahr_2026/pk1008#XXVIII_PET_00021',
    );
    expect(text).not.toMatch(/<a |<br/);
  });

  it('shows the committee result and the vote for an initiative, and no private person’s real name', () => {
    const text = formatGegenstand(detailSchema.parse(fixture('detail-bi-8.json')), '/gegenstand/XXVIII/BI/8');
    expect(text).toContain('Erstunterzeichnerin/Erstunterzeichner: Mustermann, Max');
    expect(text).toContain('zur Kenntnis genommen');
    expect(text).toContain('Dafür: ÖVP, SPÖ, NEOS, dagegen: FPÖ, GRÜNE');
  });

  it('caps a long list of press releases', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ title: `Meldung ${i + 1}`, date: '01.01.2026', url: `/aktuelles/pk${i}` }));
    const text = formatGegenstand(detailSchema.parse({ content: { title: 'X', correspondence: many } }), '/gegenstand/XXVIII/PET/1');
    expect(text).toContain('- 01.01.2026: Meldung 5');
    expect(text).not.toContain('Meldung 6');
    expect(text).toContain('- … und 3 weitere');
  });

  it('an unexpected shape of the press-release block is skipped, the rest still works', () => {
    const d = detailSchema.parse({ content: { title: 'X', correspondence: 'kaputt' } });
    expect(formatGegenstand(d, '/gegenstand/XXVIII/PET/1')).not.toContain('Pressemeldungen');
  });
});

describe('parl_gegenstaende over MCP with the new kinds', () => {
  it.each([
    ['PET', 'items-101-pet-xxviii.json', '29/PET'],
    ['BI', 'items-101-bi-xxviii.json', '/BI'],
    ['EU', 'items-101-eu-xxviii.json', '/EUBTG'],
  ])('art=%s asks the Parliament for that kind and shows the hits', async (art, file, expected) => {
    const bodies: Array<Record<string, string[]>> = [];
    const { client: parl } = clientWith((_url, init) => {
      bodies.push(JSON.parse(String(init.body)));
      return json(fixtureText(file));
    });
    const server = createServer(parl);
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(b);
    const client = new Client({ name: 'test', version: '0' });
    await client.connect(a);

    const res = await client.callTool({ name: 'parl_gegenstaende', arguments: { art, gp: 28, limit: 3 } });
    expect(res.isError).toBeFalsy();
    expect(bodies[0]).toEqual({ NRBR: ['NR'], VHG: [art], GP_CODE: ['XXVIII'] });
    const text = (res.content as Array<{ text: string }>)[0]!.text;
    expect(text).toContain(expected);
    const structured = res.structuredContent as { items: Array<{ zitation: string }> };
    expect(structured.items).toHaveLength(3);
  });

  it('refuses a kind it does not know', async () => {
    const { client: parl, fetchImpl } = clientWith(() => json({}));
    const server = createServer(parl);
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(b);
    const client = new Client({ name: 'test', version: '0' });
    await client.connect(a);
    const res = await client.callTool({ name: 'parl_gegenstaende', arguments: { art: 'ME' } }).catch(() => ({ isError: true }));
    expect(res.isError).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
