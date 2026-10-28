import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { createServer } from '../src/server.js';
import { clientWith, json, type Handler } from './helpers.js';

async function connect(handler: Handler) {
  const { client: parl, fetchImpl } = clientWith(handler);
  const server = createServer(parl);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(clientSide);
  return { client, fetchImpl };
}

async function call(client: Client, name: string, args: Record<string, unknown>) {
  const res = await client.callTool({ name, arguments: args });
  const first = (res.content as Array<{ text: string }>)[0];
  return {
    text: first?.text ?? '',
    isError: Boolean(res.isError),
    structured: res.structuredContent as Record<string, unknown> | undefined,
  };
}

/** Minimal valid arguments per tool; `gp` can be swapped in tools that take one. */
const TOOLS_WITH_GP: Array<[string, Record<string, unknown>]> = [
  ['parl_gegenstaende', {}],
  ['parl_sitzungen', {}],
  ['parl_anfragen', {}],
  ['parl_ausschuesse', {}],
  ['parl_sitzung', { nummer: 30 }],
  ['parl_rede', { nummer: 30, rede: 1 }],
  ['parl_beschluesse', { nummer: 30 }],
  ['parl_gegenstand', { zitation: '251/I' }],
];

const notFound: Handler = () => new Response('not found', { status: 404 });

describe('every tool with a legislative period rejects a bad one before talking to the Parliament', () => {
  it.each(TOOLS_WITH_GP)('%s', async (name, args) => {
    const { client, fetchImpl } = await connect(notFound);
    const res = await call(client, name, { ...args, gp: 'ABC' });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/Gesetzgebungsperiode/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each(TOOLS_WITH_GP)('%s: 28 and "xxviii" produce the same request', async (name, args) => {
    const requests = async (gp: string | number) => {
      const { client, fetchImpl } = await connect(notFound);
      await call(client, name, { ...args, gp });
      return fetchImpl.mock.calls.map((c) => {
        const [url, init] = c as unknown as [string, RequestInit];
        return `${url} ${String(init.body ?? '')}`;
      });
    };
    const numeric = await requests(28);
    const roman = await requests('xxviii');
    expect(numeric.length).toBeGreaterThan(0);
    expect(numeric.join(' | ')).toContain('XXVIII');
    expect(roman).toEqual(numeric);
  });
});

describe('upstream trouble is reported as a tool error, not as a crash', () => {
  it.each([
    ['parl_gegenstaende', {}],
    ['parl_sitzungen', {}],
    ['parl_anfragen', {}],
    ['parl_ausschuesse', {}],
    ['parl_abgeordnete', { name: 'Kickl' }],
    ['parl_person', { name: 'Kickl' }],
    ['parl_reden_person', { name: 'Kickl' }],
    ['parl_sitzung', { nummer: 30 }],
    ['parl_rede', { nummer: 30, rede: 1 }],
    ['parl_beschluesse', { nummer: 30 }],
    ['parl_gegenstand', { gp: 28, zitation: '251/I' }],
  ] as Array<[string, Record<string, unknown>]>)('%s: HTTP 404', async (name, args) => {
    const { client } = await connect(notFound);
    const res = await call(client, name, args);
    expect(res.isError).toBe(true);
    expect(res.text.length).toBeGreaterThan(10);
  });

  it.each([
    ['parl_gegenstaende', {}],
    ['parl_sitzungen', {}],
    ['parl_anfragen', {}],
    ['parl_ausschuesse', {}],
    ['parl_sitzung', { nummer: 30 }],
    ['parl_beschluesse', { nummer: 30 }],
  ] as Array<[string, Record<string, unknown>]>)('%s: an answer that is not the expected JSON', async (name, args) => {
    const { client } = await connect(() => json({ unexpected: 'shape' }));
    const res = await call(client, name, args);
    expect(res.isError).toBe(true);
  });
});

describe('empty result lists', () => {
  const header = [{ rnr: 1, label: 'Datum' }];
  const empty: Handler = () => json({ pages: 0, count: 0, header, rows: [] });

  it.each([
    ['parl_gegenstaende', {}],
    ['parl_sitzungen', {}],
    ['parl_anfragen', {}],
    ['parl_ausschuesse', { gp: 28 }],
  ] as Array<[string, Record<string, unknown>]>)('%s says so instead of returning an empty string', async (name, args) => {
    const { client } = await connect(empty);
    const res = await call(client, name, args);
    expect(res.isError).toBe(false);
    expect(res.text).toMatch(/Keine|keine/);
    if (res.structured) expect(res.structured['total']).toBe(0);
  });
});

describe('input validation by the schemas', () => {
  it.each([
    ['parl_gegenstaende', { limit: 0 }],
    ['parl_gegenstaende', { limit: 51 }],
    ['parl_gegenstaende', { offset: -1 }],
    ['parl_gegenstaende', { art: 'XYZ' }],
    ['parl_gegenstaende', { gremium: 'LT' }],
    ['parl_gegenstaende', { schlagwort: 'a' }],
    ['parl_anfragen', { offset: 20_000 }],
    ['parl_anfragen', { art: 'alle' }],
    ['parl_sitzung', { nummer: 0 }],
    ['parl_sitzung', { nummer: 10_000 }],
    ['parl_rede', { nummer: 30, rede: 0 }],
    ['parl_rede', { nummer: 30, rede: 1, max_zeichen: 999 }],
    ['parl_rede', { nummer: 30, rede: 1, max_zeichen: 1_000_000 }],
    ['parl_gegenstand', { gp: 28, zitation: '1' }],
  ] as Array<[string, Record<string, unknown>]>)('%s %j is refused', async (name, args) => {
    const { client, fetchImpl } = await connect(notFound);
    const res = await client.callTool({ name, arguments: args }).then(
      (r) => ({ isError: Boolean(r.isError) }),
      () => ({ isError: true }),
    );
    expect(res.isError).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
