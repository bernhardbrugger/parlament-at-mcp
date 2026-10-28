import { readFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { ParlamentClient } from '../src/client.js';
import { createServer } from '../src/server.js';

const fixture = readFileSync(new URL('./fixtures/persons-10400.json', import.meta.url), 'utf8');

async function connect() {
  const parl = new ParlamentClient({
    delayMs: 0,
    fetchImpl: (async () => new Response(fixture, { status: 200 })) as unknown as typeof fetch,
  });
  const server = createServer(parl);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(clientSide);
  return client;
}

describe('MCP server', () => {
  it('lists parl_abgeordnete as a read-only tool with a schema', async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === 'parl_abgeordnete');
    expect(tool).toBeDefined();
    expect(tool?.annotations?.readOnlyHint).toBe(true);
    expect(Object.keys(tool?.inputSchema.properties ?? {})).toEqual(['name', 'gremium', 'funktion', 'limit', 'offset']);
  });

  it('answers a tool call with citable results', async () => {
    const client = await connect();
    const res = await client.callTool({ name: 'parl_abgeordnete', arguments: { name: 'Kickl' } });
    const text = (res.content as Array<{ type: string; text: string }>)[0]!.text;
    expect(text).toContain('Kickl Herbert');
    expect(text).toContain('https://www.parlament.gv.at/person/35520');
  });

  it('rejects invalid arguments', async () => {
    const client = await connect();
    const res = await client.callTool({ name: 'parl_abgeordnete', arguments: { limit: 1000 } }).catch((e) => e);
    expect(res instanceof Error || (res as { isError?: boolean }).isError).toBeTruthy();
  });

  it('carries server instructions that ask for citations', async () => {
    const client = await connect();
    expect(client.getInstructions()).toContain('url');
  });
});
