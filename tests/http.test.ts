import { request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterEach, describe, expect, it } from 'vitest';
import { createHttpApp, type HttpOptions } from '../src/http.js';
import { clientWith, fixtureText, json } from './helpers.js';

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(() => r(undefined)))));
});

async function start(opts: HttpOptions = {}): Promise<{ base: string; port: number }> {
  const { client } = clientWith(() => json(fixtureText('persons-10400.json')));
  const server = createHttpApp({ client, ...opts });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  return { base: `http://127.0.0.1:${port}`, port };
}

function rawPost(port: number, path: string, body: string, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; text: string }>((resolve, reject) => {
    const req = httpRequest(
      { host: '127.0.0.1', port, path, method: 'POST', headers: { 'content-type': 'application/json', ...headers } },
      (res) => {
        let text = '';
        res.on('data', (c) => (text += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, text }));
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

describe('HTTP transport (stateless)', () => {
  it('serves the MCP protocol: list tools, call a tool', async () => {
    const { base } = await start();
    const client = new Client({ name: 'http-test', version: '0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(12);
    const res = await client.callTool({ name: 'parl_abgeordnete', arguments: { name: 'Kickl' } });
    expect((res.content as Array<{ text: string }>)[0]!.text).toContain('Kickl Herbert');
    expect((await client.listPrompts()).prompts).toHaveLength(6);
    await client.close();
  });

  it('answers /healthz and refuses everything else politely', async () => {
    const { base, port } = await start();
    const health = await fetch(`${base}/healthz`);
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ status: 'ok', name: 'parlament-at-mcp' });
    expect((await fetch(`${base}/nope`)).status).toBe(404);
    const get = await fetch(`${base}/mcp`);
    expect(get.status).toBe(405);
    expect(get.headers.get('allow')).toBe('POST');
    expect((await rawPost(port, '/healthz', '{}')).status).toBe(404);
  });

  it('rejects malformed and oversized bodies', async () => {
    const { port } = await start({ maxBodyBytes: 200 });
    const bad = await rawPost(port, '/mcp', 'not json');
    expect(bad.status).toBe(400);
    expect(JSON.parse(bad.text).error.code).toBe(-32700);
    const big = await rawPost(port, '/mcp', JSON.stringify({ x: 'y'.repeat(500) }));
    expect(big.status).toBe(413);
  });

  it('checks the Host header when hosts are configured (DNS-rebinding protection)', async () => {
    const { port } = await start({ allowedHosts: ['mcp.example.org'] });
    const denied = await rawPost(port, '/mcp', '{}');
    expect(denied.status).toBe(403);
    const ok = await rawPost(port, '/mcp', 'oops', { host: 'mcp.example.org' });
    expect(ok.status).toBe(400); // passed the host check, failed on the body
  });
});
