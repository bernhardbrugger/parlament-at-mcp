import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { BASE_URL, ParlamentError, type ParlamentClient } from '../client.js';
import { parseLegisPeriod } from '../legis-period.js';
import { fetchSlice, isoFromDe, PAGE_SIZE } from '../paging.js';
import { cleanText } from '../text.js';
import { listOutput, listResult, sitzungItemSchema } from '../output.js';
import { rowsToObjects, type FilterResponse } from '../types.js';

/** List id of the plenary sessions (and activities); request body keys: GREMIUM, GP_CODE, SIAKT. */
export const SITZUNGEN_LIST_ID = 701;
/** Column "Sort" of that list (rnr 22), used to get the newest session first. */
const SORT_RNR = 22;

export interface SitzungItem {
  gremium: 'NR' | 'BR' | string;
  gp: string | null;
  nummer: number | null;
  datum: string | null;
  titel: string;
  art: string | null;
  /** Path used by parl_sitzung, e.g. /gegenstand/XXVIII/NRSITZ/104 */
  path: string | null;
  url: string | null;
}

export interface SitzungenQuery {
  gremium: 'NR' | 'BR';
  gp?: string;
  limit: number;
  offset: number;
}

export function parseSitzungen(resp: FilterResponse): SitzungItem[] {
  const items: SitzungItem[] = [];
  for (const o of rowsToObjects(resp)) {
    const titel = typeof o['Betreff'] === 'string' ? cleanText(o['Betreff']) : '';
    const link = typeof o['col28'] === 'string' && o['col28'].startsWith('/gegenstand/') ? o['col28'] : null;
    if (!titel) continue;
    const m = link ? /\/(\d+)$/.exec(link) : null;
    items.push({
      gremium: typeof o['Gremium'] === 'string' ? o['Gremium'] : '',
      gp: typeof o['GP'] === 'string' ? o['GP'] : null,
      nummer: m ? Number(m[1]) : null,
      datum: isoFromDe(o['Datum']),
      titel,
      art: typeof o['col25'] === 'string' ? cleanText(o['col25']) || null : null,
      path: link,
      url: link ? BASE_URL + link : null,
    });
  }
  return items;
}

export async function searchSitzungen(client: ParlamentClient, q: SitzungenQuery) {
  const body: Record<string, string[]> = { GREMIUM: [q.gremium], SIAKT: ['SI'] };
  if (q.gp) body['GP_CODE'] = [q.gp];
  return fetchSlice(q.offset, q.limit, async (page) => {
    const resp = await client.filterDataPost(SITZUNGEN_LIST_ID, body, { page, pagesize: PAGE_SIZE, sortrnr: SORT_RNR, ascDesc: 'DESC' });
    return { total: resp.count, rows: parseSitzungen(resp), rawRows: resp.rows.length };
  });
}

export function formatSitzungen(result: { total: number; items: SitzungItem[] }, q: SitzungenQuery): string {
  if (result.total === 0 || result.items.length === 0) {
    return result.total === 0
      ? 'Keine Sitzungen gefunden. Gesetzgebungsperiode prüfen (z. B. XXVIII).'
      : `Keine Treffer ab offset=${q.offset}; es gibt insgesamt ${result.total}.`;
  }
  const to = q.offset + result.items.length;
  const lines = [`${result.total} Sitzungen, angezeigt ${q.offset + 1}–${to}.${to < result.total ? ` Weitere mit offset=${to}.` : ''}`, ''];
  for (const s of result.items) {
    const head = [s.nummer !== null ? `Sitzung ${s.nummer}` : null, s.datum, s.art].filter(Boolean).join(' · ');
    lines.push(`- ${head}`, `  ${s.titel}`);
    if (s.url) lines.push(`  ${s.url}`);
  }
  lines.push('', 'Tagesordnung und Redner einer Sitzung: parl_sitzung (gremium, gp, nummer).');
  return lines.join('\n');
}

export function registerSitzungen(server: McpServer, client: ParlamentClient): void {
  server.registerTool(
    'parl_sitzungen',
    {
      title: 'Plenarsitzungen von Nationalrat oder Bundesrat auflisten',
      description:
        'Listet Plenarsitzungen des Nationalrats (NR) oder Bundesrats (BR), neueste zuerst, mit Nummer, Datum, Art (Sitzung oder Zuweisungssitzung) und Link. ' +
        'Optional nach Gesetzgebungsperiode filtern (nur NR sinnvoll, z. B. 28 oder "XXVIII"). ' +
        'Für Tagesordnung, Redner und Reden einer bestimmten Sitzung: parl_sitzung und parl_rede. Quelle: offene Daten des Parlaments (CC BY 4.0).',
      inputSchema: {
        gremium: z.enum(['NR', 'BR']).default('NR').describe('NR = Nationalrat, BR = Bundesrat'),
        gp: z
          .union([z.string().min(1).max(8), z.number().int().min(1).max(40)])
          .optional()
          .describe('Gesetzgebungsperiode, nur für den Nationalrat'),
        limit: z.number().int().min(1).max(50).default(10).describe('Anzahl Sitzungen pro Aufruf'),
        offset: z.number().int().min(0).max(5000).default(0).describe('Sitzungen überspringen (Seiten)'),
      },
      outputSchema: listOutput(sitzungItemSchema),
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (args) => {
      let gp: string | undefined;
      try {
        gp = args.gp === undefined ? undefined : parseLegisPeriod(args.gp);
      } catch (e) {
        return { isError: true, content: [{ type: 'text', text: (e as Error).message }] };
      }
      const query: SitzungenQuery = {
        gremium: args.gremium,
        limit: args.limit,
        offset: args.offset,
        ...(gp ? { gp } : {}),
      };
      try {
        const result = await searchSitzungen(client, query);
        return listResult(formatSitzungen(result, query), result.total, query.offset, result.items);
      } catch (e) {
        if (e instanceof ParlamentError)
          return { isError: true, content: [{ type: 'text', text: `Das Parlament hat nicht geantwortet: ${e.message}` }] };
        throw e;
      }
    },
  );
}
