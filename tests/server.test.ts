import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { createServer } from '../src/server.js';
import { clientWith, fixtureText, json } from './helpers.js';

/** Routes by URL to the recorded real responses; anything else is a test bug. */
function router(url: string, init: RequestInit): Response {
  if (url.includes('/Filter/api/filter/data/10400')) return json(fixtureText('persons-10400.json'));
  if (url.includes('FBEZ=WFP_005')) {
    const body = JSON.parse(String(init.body)) as Record<string, string[]>;
    return json(fixtureText(body['JMAB']?.[0] === 'AB_ABPR_ABM' ? 'beantwortungen-wfp005-page1.json' : 'anfragen-wfp005-page1.json'));
  }
  if (url.endsWith('/gegenstand/XXVIII/J/7436?json=TRUE')) return json(fixtureText('detail-j-7436.json'));
  if (url.endsWith('/gegenstand/XXVIII/AB/6209?json=TRUE')) return json(fixtureText('detail-ab.json'));
  if (url.includes('/Filter/api/filter/data/701')) {
    const body = JSON.parse(String(init.body)) as Record<string, string[]>;
    return json(fixtureText(body['GREMIUM']?.[0] === 'BR' ? 'sessions-701-br.json' : 'sessions-701-nr-xxviii.json'));
  }
  if (url.includes('/Filter/api/filter/data/101')) return json(fixtureText('items-101-rv-xxviii.json'));
  if (url.endsWith('/gegenstand/XXVIII/NRSITZ/30?json=TRUE')) return json(fixtureText('session-nr-xxviii-30.json'));
  if (url.endsWith('/dokument/XXVIII/NRSITZ/30/A_-_11_12_46_00801352.html'))
    return new Response(fixtureText('speech-kickl-A_-_11_12_46_00801352.html'), { status: 200 });
  if (url.endsWith('/gegenstand/XXVIII/I/251?json=TRUE')) return json(fixtureText('detail-rv-251.json'));
  if (url.includes('FBEZ=WFW_002')) return json(fixtureText('members-wfw002-nr.json'));
  if (url.includes('FBEZ=WFW_005')) return json(fixtureText('members-wfw005-br.json'));
  if (url.includes('FBEZ=WFP_009')) return json(fixtureText('committees-wfp009-nr-xxviii.json'));
  if (url.includes('/Filter/api/filter/data/251')) return json(fixtureText('person-reden-251.json'));
  if (url.endsWith('/person/91034?json=TRUE')) return json(fixtureText('person-91034.json'));
  if (url.endsWith('/ausschuss/XXVIII/A-AS/1/00917?json=TRUE')) return json(fixtureText('detail-committee-as.json'));
  if (url.includes('/gegenstand/')) return new Response('not found', { status: 404 });
  throw new Error(`unexpected request: ${url}`);
}

async function connect() {
  const { client: parl, fetchImpl } = clientWith(router);
  const server = createServer(parl);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(clientSide);
  return { client, fetchImpl };
}

async function call(client: Client, name: string, args: Record<string, unknown>) {
  const res = await client.callTool({ name, arguments: args });
  return { text: (res.content as Array<{ text: string }>)[0]!.text, isError: Boolean(res.isError) };
}

describe('MCP server', () => {
  it('lists ten read-only tools, each with a schema and description', async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        'parl_abgeordnete',
        'parl_anfragen',
        'parl_ausschuesse',
        'parl_gegenstaende',
        'parl_gegenstand',
        'parl_person',
        'parl_rede',
        'parl_reden_person',
        'parl_sitzung',
        'parl_sitzungen',
      ].sort(),
    );
    for (const t of tools) {
      expect(t.annotations?.readOnlyHint).toBe(true);
      expect(t.description?.length).toBeGreaterThan(80);
      expect(t.inputSchema.type).toBe('object');
    }
  });

  it('parl_abgeordnete answers with citable results', async () => {
    const { client } = await connect();
    const { text } = await call(client, 'parl_abgeordnete', { name: 'Kickl' });
    expect(text).toContain('Kickl Herbert');
    expect(text).toContain('https://www.parlament.gv.at/person/35520');
  });

  it('parl_anfragen lists inquiries and sends array bodies', async () => {
    const { client, fetchImpl } = await connect();
    const { text, isError } = await call(client, 'parl_anfragen', { suche: 'Digitalzwang', gp: 28, limit: 3 });
    expect(isError).toBe(false);
    expect(text).toContain('7436/J');
    expect(text).toContain('https://www.parlament.gv.at/gegenstand/XXVIII/J/7436');
    const sent = JSON.parse(String((fetchImpl.mock.calls[0]![1] as RequestInit).body));
    expect(sent).toEqual({ NRBR: ['NR'], GP: ['XXVIII'], JMAB: ['J_JPR_M'], SUCH: ['Digitalzwang'] });
  });

  it('parl_anfragen can list answers', async () => {
    const { client } = await connect();
    const { text } = await call(client, 'parl_anfragen', { art: 'beantwortung', limit: 2 });
    expect(text).toContain('6209/AB');
  });

  it('parl_anfragen reports an invalid legislative period as a tool error', async () => {
    const { client } = await connect();
    const { text, isError } = await call(client, 'parl_anfragen', { gp: 'IIII' });
    expect(isError).toBe(true);
    expect(text).toContain('Gesetzgebungsperiode');
  });

  it('parl_gegenstand shows who asked, with party and documents', async () => {
    const { client } = await connect();
    const { text, isError } = await call(client, 'parl_gegenstand', { gp: 'XXVIII', zitation: '7436/J' });
    expect(isError).toBe(false);
    expect(text).toContain('Eingebracht von: Peter Wurm (F)');
    expect(text).toContain('.pdf');
  });

  it('parl_gegenstand explains unknown items and bad citations', async () => {
    const { client } = await connect();
    const missing = await call(client, 'parl_gegenstand', { gp: 28, zitation: '999999/J' });
    expect(missing.isError).toBe(true);
    expect(missing.text).toContain('Kein Gegenstand');
    const bad = await call(client, 'parl_gegenstand', { gp: 28, zitation: '../../x' });
    expect(bad.isError).toBe(true);
    expect(bad.text).toContain('Zitation');
  });

  it('parl_sitzungen lists sessions of both chambers', async () => {
    const { client } = await connect();
    const nr = await call(client, 'parl_sitzungen', { gp: 28, limit: 2 });
    expect(nr.text).toContain('Sitzung 104 · 2026-10-15');
    const br = await call(client, 'parl_sitzungen', { gremium: 'BR', limit: 1 });
    expect(br.text).toContain('Sitzung 997');
  });

  it('parl_sitzung shows the speakers and parl_rede reads one speech', async () => {
    const { client } = await connect();
    const outline = await call(client, 'parl_sitzung', { gp: 28, nummer: 30, redner: 'Kickl' });
    expect(outline.isError).toBe(false);
    expect(outline.text).toContain('Herbert Kickl (FPÖ) · rede=801352');
    const speech = await call(client, 'parl_rede', { gp: 28, nummer: 30, rede: 801352 });
    expect(speech.isError).toBe(false);
    expect(speech.text).toContain('Herbert Kickl (FPÖ)');
    expect(speech.text).toContain('Danke schön, Herr Präsident!');
    expect(speech.text).toContain('Na bravo!');
    const quiet = await call(client, 'parl_rede', { gp: 28, nummer: 30, rede: 801352, zwischenrufe: false });
    expect(quiet.text).not.toContain('Na bravo!');
  });

  it('parl_rede and parl_sitzung explain unknown input', async () => {
    const { client } = await connect();
    const noGp = await call(client, 'parl_sitzung', { nummer: 30 });
    expect(noGp.isError).toBe(true);
    expect(noGp.text).toContain('Gesetzgebungsperiode');
    const unknown = await call(client, 'parl_rede', { gp: 28, nummer: 30, rede: 5 });
    expect(unknown.isError).toBe(true);
    expect(unknown.text).toContain('Kein Redebeitrag');
    const missing = await call(client, 'parl_sitzung', { gp: 28, nummer: 9999 });
    expect(missing.isError).toBe(true);
    expect(missing.text).toContain('Keine Sitzung');
  });

  it('parl_gegenstaende lists bills and parl_gegenstand shows the procedure', async () => {
    const { client } = await connect();
    const list = await call(client, 'parl_gegenstaende', { gp: 28, limit: 3 });
    expect(list.text).toContain('251/I');
    const detail = await call(client, 'parl_gegenstand', { gp: 28, zitation: '251/I' });
    expect(detail.text).toContain('Verfahren:');
    expect(detail.text).toContain('Bundesgesetzblatt I Nr. 86/2025');
  });

  it('parl_abgeordnete marks current members and filters by club', async () => {
    const { client } = await connect();
    const res = await call(client, 'parl_abgeordnete', { nur_aktuell: true, klub: 'NEOS' });
    expect(res.isError).toBe(false);
    expect(res.text).toContain('Aldali Lisa');
    expect(res.text).toContain('AKTUELL im Nationalrat · Klub NEOS');
    expect(res.text).not.toContain('Kickl');
  });

  it('parl_person shows the biography, parl_reden_person lists the speeches', async () => {
    const { client } = await connect();
    const bio = await call(client, 'parl_person', { name: 'Rendi-Wagner' });
    expect(bio.isError).toBe(false);
    expect(bio.text).toContain('Mandate und Funktionen:');
    expect(bio.text).toContain('Geb.: 07.05.1971, Wien');
    const speeches = await call(client, 'parl_reden_person', { pad_intern: 91034, limit: 3 });
    expect(speeches.isError).toBe(false);
    expect(speeches.text).toContain('129 Reden von');
    expect(speeches.text).toContain('Bundes-Energieeffizienzgesetz');
  });

  it('parl_person asks for clarification when a name is ambiguous or unknown', async () => {
    const { client } = await connect();
    const ambiguous = await call(client, 'parl_person', { name: 'Androsch' });
    expect(ambiguous.isError).toBe(true);
    expect(ambiguous.text).toContain('nicht eindeutig');
    const unknown = await call(client, 'parl_reden_person', { name: 'Zzzzzz' });
    expect(unknown.isError).toBe(true);
    const nothing = await call(client, 'parl_person', {});
    expect(nothing.isError).toBe(true);
    expect(nothing.text).toContain('pad_intern oder name');
  });

  it('parl_ausschuesse lists committees and shows the chairs for a narrow search', async () => {
    const { client } = await connect();
    const list = await call(client, 'parl_ausschuesse', { gp: 28 });
    expect(list.isError).toBe(false);
    expect(list.text).toContain('8 Ausschüsse der XXVIII. GP');
    const detail = await call(client, 'parl_ausschuesse', { gp: 28, suche: 'Arbeit' });
    expect(detail.text).toContain('Obmann: Josef Muchitsch');
    const noGp = await call(client, 'parl_ausschuesse', {});
    expect(noGp.isError).toBe(true);
    expect(noGp.text).toContain('Gesetzgebungsperiode');
  });

  it('list tools return machine-readable structuredContent next to the text', async () => {
    const { client } = await connect();
    const res = await client.callTool({ name: 'parl_anfragen', arguments: { gp: 28, limit: 3 } });
    const sc = res.structuredContent as { total: number; offset: number; items: Array<{ zitation: string; url: string | null }> };
    expect(sc.total).toBe(7562);
    expect(sc.offset).toBe(0);
    expect(sc.items).toHaveLength(3);
    expect(sc.items[0]).toMatchObject({ zitation: '7436/J', url: 'https://www.parlament.gv.at/gegenstand/XXVIII/J/7436' });
    const persons = await client.callTool({ name: 'parl_abgeordnete', arguments: { nur_aktuell: true } });
    const people = (persons.structuredContent as { items: Array<{ padIntern: number; aktuell: { gremium: string } | null }> }).items;
    expect(people.map((p) => p.padIntern).sort()).toEqual([24110, 38385]);
    expect(people.every((p) => p.aktuell !== null)).toBe(true);
    const sessions = await client.callTool({ name: 'parl_sitzungen', arguments: { gp: 28, limit: 2 } });
    expect((sessions.structuredContent as { items: Array<{ nummer: number }> }).items.map((i) => i.nummer)).toEqual([104, 103]);
    const bills = await client.callTool({ name: 'parl_gegenstaende', arguments: { gp: 28, limit: 2 } });
    expect((bills.structuredContent as { items: Array<{ zitation: string }> }).items[0]!.zitation).toBe('251/I');
    const speeches = await client.callTool({ name: 'parl_reden_person', arguments: { pad_intern: 91034, limit: 2 } });
    expect((speeches.structuredContent as { total: number }).total).toBe(129);
  });

  it('declares an output schema on the list tools', async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    const withSchema = tools
      .filter((t) => t.outputSchema)
      .map((t) => t.name)
      .sort();
    expect(withSchema).toEqual(['parl_abgeordnete', 'parl_anfragen', 'parl_gegenstaende', 'parl_reden_person', 'parl_sitzungen']);
    expect(Object.keys(tools.find((t) => t.name === 'parl_anfragen')!.outputSchema!.properties!)).toEqual(['total', 'offset', 'items']);
  });

  it('offers research prompts that chain the tools', async () => {
    const { client } = await connect();
    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name).sort()).toEqual([
      'abgeordnete_profil',
      'anfragen_zum_thema',
      'ausschuss_ueberblick',
      'gesetz_verfolgen',
      'rede_recherchieren',
    ]);
    const rede = await client.getPrompt({ name: 'rede_recherchieren', arguments: { redner: 'Herbert Kickl', thema: 'Budget' } });
    const text = (rede.messages[0]!.content as { text: string }).text;
    expect(text).toContain('Herbert Kickl');
    expect(text).toContain('Budget');
    for (const tool of ['parl_reden_person', 'parl_sitzung', 'parl_rede']) expect(text).toContain(tool);
    expect(text).toContain('Rechtsberatung');
    const law = await client.getPrompt({ name: 'gesetz_verfolgen', arguments: { gesetz: 'Verwaltungsverfahren' } });
    expect((law.messages[0]!.content as { text: string }).text).toContain('XXVIII');
    await expect(client.getPrompt({ name: 'rede_recherchieren', arguments: {} })).rejects.toThrow();
  });

  it('rejects out-of-range arguments before any request is made', async () => {
    const { client, fetchImpl } = await connect();
    const res = await client.callTool({ name: 'parl_anfragen', arguments: { limit: 1000 } }).catch((e) => e);
    expect(res instanceof Error || (res as { isError?: boolean }).isError).toBeTruthy();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('carries server instructions that ask for citations', async () => {
    const { client } = await connect();
    expect(client.getInstructions()).toContain('url');
  });
});
