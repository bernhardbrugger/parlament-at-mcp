import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { BASE_URL, ParlamentError, type ParlamentClient } from '../client.js';
import { parseLegisPeriod } from '../legis-period.js';
import { cleanText, htmlAttr, truncate } from '../text.js';
import { anfrageItemSchema, KOMPAKT_HINWEIS, kompaktInput, listOutput, listResult } from '../output.js';
import { rowsToObjects, type FilterResponse } from '../types.js';

/** Feld-Bezeichner of the inquiries-and-answers list. */
export const ANFRAGEN_FBEZ = 'WFP_005';
/** The server pages 50 rows at a time. */
export const PAGE_SIZE = 50;
/** Observed: without a legislative period the reported count stops at 20,004 (probably a cap). */
const COUNT_CAP = 20_000;

const ART_CODES = { anfrage: 'J_JPR_M', beantwortung: 'AB_ABPR_ABM' } as const;

export interface AnfrageItem {
  /** Citation as printed by the Parliament, e.g. "7436/J" (inquiry) or "6209/AB" (answer). */
  zitation: string;
  /** ISO date of the last update shown in the list (YYYY-MM-DD). */
  datum: string | null;
  /** Short code, e.g. "J" (written inquiry) or "AB" (answer). */
  artCode: string | null;
  /** Long name, e.g. "Schriftliche Anfrage". */
  art: string | null;
  betreff: string;
  status: string | null;
  url: string | null;
}

export interface AnfragenQuery {
  gremium: 'NR' | 'BR';
  gp?: string;
  art: 'anfrage' | 'beantwortung';
  suche?: string;
  limit: number;
  offset: number;
  /** One line per hit. */
  kompakt?: boolean;
}

/** "27.10.2026" -> "2026-10-27" */
function isoDate(s: unknown): string | null {
  const m = typeof s === 'string' ? /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(s.trim()) : null;
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

export function parseAnfragen(resp: FilterResponse): AnfrageItem[] {
  const items: AnfrageItem[] = [];
  for (const o of rowsToObjects(resp)) {
    const zitation = typeof o['Nr.'] === 'string' ? cleanText(o['Nr.']) : '';
    const betreff = typeof o['Betreff'] === 'string' ? cleanText(o['Betreff']) : '';
    if (!zitation || !betreff) continue;
    const link = typeof o['link'] === 'string' && o['link'].startsWith('/') ? o['link'] : null;
    items.push({
      zitation,
      datum: isoDate(o['Aktualisierung']),
      artCode: typeof o['Art'] === 'string' ? cleanText(o['Art']) || null : null,
      art: htmlAttr(o['Art'], 'title'),
      betreff,
      status: htmlAttr(o['Status'], 'title'),
      url: link ? BASE_URL + link : null,
    });
  }
  return items;
}

export function buildBody(q: Pick<AnfragenQuery, 'gremium' | 'gp' | 'art' | 'suche'>): Record<string, string[]> {
  const body: Record<string, string[]> = { NRBR: [q.gremium] };
  if (q.gp) body['GP'] = [q.gp];
  // The server cannot combine both types in one query (two values still return inquiries only); the default is inquiries.
  body['JMAB'] = [ART_CODES[q.art]];
  if (q.suche) body['SUCH'] = [q.suche]; // an array: a plain string makes the server answer 500
  return body;
}

export interface AnfragenResult {
  total: number;
  items: AnfrageItem[];
}

/** Fetch the pages that cover offset..offset+limit (at most two requests) and slice. */
export async function searchAnfragen(client: ParlamentClient, q: AnfragenQuery): Promise<AnfragenResult> {
  const body = buildBody(q);
  const firstPage = Math.floor(q.offset / PAGE_SIZE) + 1;
  const lastPage = Math.floor((q.offset + q.limit - 1) / PAGE_SIZE) + 1;
  let total = 0;
  const rows: AnfrageItem[] = [];
  for (let page = firstPage; page <= lastPage; page++) {
    const resp = await client.filterPost(ANFRAGEN_FBEZ, body, { page });
    total = resp.count;
    const items = parseAnfragen(resp);
    rows.push(...items);
    if (resp.rows.length < PAGE_SIZE) break; // last page
  }
  const start = q.offset - (firstPage - 1) * PAGE_SIZE;
  return { total, items: rows.slice(start, start + q.limit) };
}

export function formatAnfragen(result: AnfragenResult, q: AnfragenQuery): string {
  if (result.total === 0 || result.items.length === 0) {
    return result.total === 0
      ? 'Keine Treffer. Tipp: Suchbegriff kürzer oder allgemeiner wählen, Gesetzgebungsperiode weglassen oder "art" auf "beantwortung" umstellen (Anfragen und Beantwortungen werden getrennt abgefragt).'
      : `Keine Treffer ab offset=${q.offset}; es gibt insgesamt ${result.total}.`;
  }
  const from = q.offset + 1;
  const to = q.offset + result.items.length;
  const lines = [`${result.total >= COUNT_CAP ? 'mindestens ' : ''}${result.total} Treffer, angezeigt ${from}–${to}.`];
  if (result.total >= COUNT_CAP) {
    lines.push(
      'Hinweis: Die Schnittstelle zählt höchstens rund 20.000 Treffer. Mit "gp" (Gesetzgebungsperiode) oder "suche" eingrenzen, um alles zu erreichen.',
    );
  }
  if (to < result.total) lines.push(`Weitere Treffer mit offset=${to}.`);
  lines.push('');
  for (const it of result.items) {
    if (q.kompakt) {
      lines.push(`- ${[it.zitation, it.datum, truncate(it.betreff, 100), it.url].filter(Boolean).join(' · ')}`);
      continue;
    }
    const head = [it.zitation, it.datum, it.art ?? it.artCode].filter(Boolean).join(' · ');
    lines.push(`- ${head}`);
    lines.push(`  ${truncate(it.betreff, 300)}`);
    if (it.status) lines.push(`  Status: ${it.status}`);
    if (it.url) lines.push(`  ${it.url}`);
  }
  lines.push('', 'Einbringer, Verlauf und Dokumente: parl_gegenstand mit gp und zitation.');
  if (q.kompakt) lines.push(KOMPAKT_HINWEIS);
  return lines.join('\n');
}

export function registerAnfragen(server: McpServer, client: ParlamentClient): void {
  server.registerTool(
    'parl_anfragen',
    {
      title: 'Parlamentarische Anfragen und Anfragebeantwortungen suchen',
      description:
        'Sucht schriftliche parlamentarische Anfragen und deren Beantwortungen im Nationalrat oder Bundesrat, neueste zuerst. ' +
        'Filter: Gesetzgebungsperiode (gp, z. B. "XXVIII" oder 28), Art (Anfrage oder Beantwortung, getrennt abgefragt) und Suchbegriff (im Betreff). ' +
        'Die Liste enthält Nummer, Datum, Betreff, Status und Link, aber NICHT, wer die Anfrage gestellt hat; ' +
        'das (Partei, Ministerium) liefert parl_gegenstand zur jeweiligen Nummer. Ohne gp ist die Trefferzahl auf rund 20.000 begrenzt. ' +
        'Quelle: offene Daten des Parlaments (CC BY 4.0).',
      inputSchema: {
        suche: z.string().min(2).max(200).optional().describe('Suchbegriff, z. B. "Budget" oder "Polizeischutz"'),
        gp: z
          .union([z.string().min(1).max(8), z.number().int().min(1).max(40)])
          .optional()
          .describe('Gesetzgebungsperiode: 28 oder "XXVIII"'),
        gremium: z.enum(['NR', 'BR']).default('NR').describe('NR = Nationalrat, BR = Bundesrat'),
        art: z
          .enum(['anfrage', 'beantwortung'])
          .default('anfrage')
          .describe('Anfragen oder Anfragebeantwortungen (nicht beides in einer Abfrage)'),
        limit: z.number().int().min(1).max(50).default(15).describe('Anzahl Treffer pro Aufruf'),
        offset: z.number().int().min(0).max(19_950).default(0).describe('Treffer überspringen (Seiten)'),
        kompakt: kompaktInput,
      },
      outputSchema: listOutput(anfrageItemSchema),
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (args) => {
      let gp: string | undefined;
      try {
        gp = args.gp === undefined ? undefined : parseLegisPeriod(args.gp);
      } catch (e) {
        return { isError: true, content: [{ type: 'text', text: (e as Error).message }] };
      }
      const query: AnfragenQuery = {
        gremium: args.gremium,
        art: args.art,
        limit: args.limit,
        offset: args.offset,
        kompakt: args.kompakt,
        ...(gp ? { gp } : {}),
        ...(args.suche ? { suche: args.suche } : {}),
      };
      try {
        const result = await searchAnfragen(client, query);
        return listResult(formatAnfragen(result, query), result.total, query.offset, result.items);
      } catch (e) {
        if (e instanceof ParlamentError) {
          return { isError: true, content: [{ type: 'text', text: `Das Parlament hat nicht geantwortet: ${e.message}` }] };
        }
        throw e;
      }
    },
  );
}
