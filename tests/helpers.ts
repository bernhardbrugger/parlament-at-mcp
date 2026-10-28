import { readFileSync } from 'node:fs';
import { vi } from 'vitest';
import { ParlamentClient } from '../src/client.js';

export function fixtureText(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
}

export function fixture<T = any>(name: string): T {
  return JSON.parse(fixtureText(name)) as T;
}

export type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;

/** A client whose fetch is answered by `handler`; no waiting between requests. Returns the fetch spy too. */
export function clientWith(handler: Handler) {
  const fetchImpl = vi.fn(async (url: string, init: RequestInit) => handler(url, init));
  const client = new ParlamentClient({ delayMs: 0, fetchImpl: fetchImpl as unknown as typeof fetch });
  return { client, fetchImpl };
}

export function json(body: unknown, status = 200): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
}

/** `n` synthetic inquiry rows in the real column layout, numbered from `startNr` downwards. */
export function syntheticPage(count: number, startNr: number, n: number) {
  const rows = Array.from({ length: n }, (_, i) => {
    const nr = startNr - i;
    return [
      '27.10.2026',
      '<span title="Schriftliche Anfrage" class="zeigeTooltip">J</span>',
      `Betreff Nummer ${nr}`,
      `${nr}/J`,
      '<div class="status" title="Einlangen im Nationalrat"></div>',
      'rss',
      `/gegenstand/XXVIII/J/${nr}`,
      `/gegenstand/XXVIII/J/${nr}`,
    ];
  });
  const header = [
    { rnr: 1, label: 'Aktualisierung' },
    { rnr: 2, label: 'Art' },
    { rnr: 3, label: 'Betreff' },
    { rnr: 4, label: 'Nr.' },
    { rnr: 5, label: 'Status' },
    { rnr: 6, label: 'RSS Description', hidden: true },
    { label: 'link', hidden: true },
    { label: 'link', hidden: true },
  ];
  return { pages: Math.ceil(count / 50), count, header, rows };
}
