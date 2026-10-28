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
  it('lists three read-only tools, each with a schema and description', async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['parl_abgeordnete', 'parl_anfragen', 'parl_gegenstand']);
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
