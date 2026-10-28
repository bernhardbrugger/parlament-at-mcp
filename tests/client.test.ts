import { describe, expect, it, vi } from 'vitest';
import { ParlamentClient, ParlamentError } from '../src/client.js';

const envelope = { pages: 1, count: 1, header: [{ rnr: 1, label: 'a' }], rows: [['x']] };

function reply(status: number, body: unknown = envelope): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
}

function make(responses: Array<Response | Error>, extra: Record<string, unknown> = {}) {
  const queue = [...responses];
  const fetchImpl = vi.fn(async () => {
    const next = queue.shift();
    if (!next) throw new Error('unexpected extra request');
    if (next instanceof Error) throw next;
    return next;
  });
  const sleeps: number[] = [];
  let clock = 0;
  const client = new ParlamentClient({
    fetchImpl: fetchImpl as unknown as typeof fetch,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
    now: () => clock,
    ...extra,
  });
  return { client, fetchImpl, sleeps };
}

describe('ParlamentClient', () => {
  it('only talks to www.parlament.gv.at', () => {
    expect(() => new ParlamentClient({ baseUrl: 'https://evil.example.com' })).toThrow(ParlamentError);
    expect(() => new ParlamentClient({ baseUrl: 'https://parlament.gv.at.evil.example.com' })).toThrow(ParlamentError);
    expect(() => new ParlamentClient({ baseUrl: 'https://www.parlament.gv.at' })).not.toThrow();
  });

  it('GETs a list and validates the envelope', async () => {
    const { client, fetchImpl } = make([reply(200)]);
    const resp = await client.filterData(10400);
    expect(resp.count).toBe(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://www.parlament.gv.at/Filter/api/filter/data/10400?js=eval&showAll=true');
    expect(init.method).toBe('GET');
    expect((init.headers as Record<string, string>)['User-Agent']).toContain('parlament-at-mcp');
  });

  it('POSTs filter queries with array values as JSON', async () => {
    const { client, fetchImpl } = make([reply(200)]);
    await client.filterPost('WFP_005', { NRBR: ['NR'], GP: ['XXVIII'] });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/Filter/api/json/post?');
    expect(url).toContain('FBEZ=WFP_005');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ NRBR: ['NR'], GP: ['XXVIII'] });
  });

  it('retries 5xx with exponential backoff and then succeeds', async () => {
    const { client, fetchImpl, sleeps } = make([reply(503, 'x'), reply(500, 'x'), reply(200)]);
    await expect(client.filterData(1)).resolves.toBeDefined();
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleeps.filter((s) => s >= 2000)).toEqual([2000, 4000]);
  });

  it('retries network errors', async () => {
    const { client, fetchImpl } = make([new TypeError('fetch failed'), reply(200)]);
    await client.filterData(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('gives up after the configured retries', async () => {
    const { client, fetchImpl } = make([reply(502, 'x'), reply(502, 'x'), reply(502, 'x')]);
    await expect(client.filterData(1)).rejects.toThrow(/gave up/);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('does not retry client errors', async () => {
    const { client, fetchImpl } = make([reply(404, 'nope')]);
    await expect(client.filterData(1)).rejects.toThrow(/HTTP 404/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('keeps the pause between requests, even for parallel calls', async () => {
    const { client, sleeps } = make([reply(200), reply(200), reply(200)], { delayMs: 1000 });
    await Promise.all([client.filterData(1), client.filterData(2), client.filterData(3)]);
    expect(sleeps).toEqual([1000, 1000]); // the first request needs no pause
  });

  it('rejects non-JSON and unexpected shapes', async () => {
    await expect(make([reply(200, '<html>oops</html>')]).client.filterData(1)).rejects.toThrow(/not JSON/);
    await expect(make([reply(200, { rows: 'nope' })]).client.filterData(1)).rejects.toThrow(/Unexpected response shape/);
  });

  it('caches loader results for the ttl', async () => {
    let clock = 0;
    const client = new ParlamentClient({ now: () => clock });
    const load = vi.fn(async () => 42);
    expect(await client.cached('k', 1000, load)).toBe(42);
    expect(await client.cached('k', 1000, load)).toBe(42);
    expect(load).toHaveBeenCalledTimes(1);
    clock = 1500;
    await client.cached('k', 1000, load);
    expect(load).toHaveBeenCalledTimes(2);
  });
});
