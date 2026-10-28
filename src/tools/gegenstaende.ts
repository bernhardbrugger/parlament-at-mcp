import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { BASE_URL, ParlamentError, type ParlamentClient } from '../client.js';
import { parseLegisPeriod } from '../legis-period.js';
import { fetchSlice, isoFromDe, PAGE_SIZE } from '../paging.js';
import { cleanText, truncate } from '../text.js';
import { gegenstandItemSchema, listOutput, listResult } from '../output.js';
import { rowsToObjects, type FilterResponse } from '../types.js';

/** List id of the "Verhandlungsgegenstände" (bills, motions, petitions, ...). Body keys: NRBR, GP_CODE, VHG, SW, ... */
export const GEGENSTAENDE_LIST_ID = 101;

/** Types verified against the live list. The key is the value of the API's `VHG` filter. */
export const ARTEN = {
  RV: 'Regierungsvorlage',
  ANTR: 'Antrag (Initiativ-, Entschließungsantrag u. a.)',
  VOLKBG: 'Volksbegehren',
} as const;
export type Art = keyof typeof ARTEN;

export interface GegenstandItem {
  /** "251/I" - pass this with gp to parl_gegenstand. */
  zitation: string;
  nummerText: string | null;
  datum: string | null;
  art: string | null;
  artLang: string | null;
  betreff: string;
  abstimmung: string | null;
  themen: string[];
  schlagworte: string[];
  url: string | null;
}

export interface GegenstaendeQuery {
  gremium: 'NR' | 'BR';
  art: Art;
  gp?: string;
  schlagwort?: string;
  limit: number;
  offset: number;
}

function jsonList(v: unknown): string[] {
  if (typeof v !== 'string') return [];
  try {
    const parsed: unknown = JSON.parse(v);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string' && x !== '').map(cleanText) : [];
  } catch {
    return [];
  }
}

export function parseGegenstaende(resp: FilterResponse): GegenstandItem[] {
  const items: GegenstandItem[] = [];
  for (const o of rowsToObjects(resp)) {
    const betreff = typeof o['Betreff'] === 'string' ? cleanText(o['Betreff']) : '';
    const inr = o['INR'] !== undefined && o['INR'] !== null ? String(o['INR']) : '';
    const ityp = typeof o['ITYP'] === 'string' ? o['ITYP'] : '';
    if (!betreff || !inr || !ityp) continue;
    const link = typeof o['HIS_URL'] === 'string' && o['HIS_URL'].startsWith('/') ? o['HIS_URL'] : null;
    const abst = typeof o['Abstimmungstext'] === 'string' ? cleanText(o['Abstimmungstext']) : '';
    items.push({
      zitation: `${inr}/${ityp}`,
      nummerText: typeof o['Nummer'] === 'string' ? cleanText(o['Nummer']) || null : null,
      datum: isoFromDe(o['Datum']),
      art: typeof o['Art'] === 'string' ? cleanText(o['Art']) || null : null,
      artLang: typeof o['DOKTYP_LANG'] === 'string' ? cleanText(o['DOKTYP_LANG']) || null : null,
      betreff,
      abstimmung: abst || null,
      themen: jsonList(o['THEMEN']),
      schlagworte: jsonList(o['SW']),
      url: link ? BASE_URL + link : null,
    });
  }
  return items;
}

export function buildBody(q: Pick<GegenstaendeQuery, 'gremium' | 'art' | 'gp' | 'schlagwort'>): Record<string, string[]> {
  const body: Record<string, string[]> = { NRBR: [q.gremium], VHG: [q.art] };
  if (q.gp) body['GP_CODE'] = [q.gp];
  if (q.schlagwort) body['SW'] = [q.schlagwort];
  return body;
}

export async function searchGegenstaende(client: ParlamentClient, q: GegenstaendeQuery) {
  const body = buildBody(q);
  return fetchSlice(q.offset, q.limit, async (page) => {
    const resp = await client.filterDataPost(GEGENSTAENDE_LIST_ID, body, { page, pagesize: PAGE_SIZE });
    return { total: resp.count, rows: parseGegenstaende(resp), rawRows: resp.rows.length };
  });
}

export function formatGegenstaende(result: { total: number; items: GegenstandItem[] }, q: GegenstaendeQuery): string {
  if (result.total === 0 || result.items.length === 0) {
    return result.total === 0
      ? 'Keine Gegenstände gefunden. Tipp: Schlagwort weglassen oder allgemeiner wählen, die Gesetzgebungsperiode prüfen. Schlagwörter sind amtliche Begriffe wie "Verwaltungsverfahren", kein Volltext.'
      : `Keine Treffer ab offset=${q.offset}; es gibt insgesamt ${result.total}.`;
  }
  const to = q.offset + result.items.length;
  const lines = [
    `${result.total} ${ARTEN[q.art]}-Treffer, angezeigt ${q.offset + 1}–${to}.${to < result.total ? ` Weitere mit offset=${to}.` : ''}`,
    '',
  ];
  for (const it of result.items) {
    lines.push(`- ${[it.zitation, it.nummerText, it.datum].filter(Boolean).join(' · ')}`);
    lines.push(`  ${truncate(it.betreff, 300)}`);
    if (it.artLang) lines.push(`  ${it.artLang}`);
    if (it.abstimmung) lines.push(`  Abstimmung: ${it.abstimmung}`);
    if (it.themen.length) lines.push(`  Themen: ${it.themen.join(', ')}`);
    if (it.url) lines.push(`  ${it.url}`);
  }
  lines.push('', 'Stand im Gesetzgebungsverfahren, Einbringer, Dokumente: parl_gegenstand mit gp und der Zitation (z. B. "251/I").');
  return lines.join('\n');
}

export function registerGegenstaende(server: McpServer, client: ParlamentClient): void {
  server.registerTool(
    'parl_gegenstaende',
    {
      title: 'Gesetzesvorlagen, Anträge und Volksbegehren suchen',
      description:
        'Listet Verhandlungsgegenstände des Nationalrats oder Bundesrats, neueste zuerst: Regierungsvorlagen (RV), Anträge (ANTR) oder Volksbegehren (VOLKBG). ' +
        'Filter: Gesetzgebungsperiode (gp) und amtliches Schlagwort (z. B. "Verwaltungsverfahren"; kein Volltext). ' +
        'Jeder Treffer hat eine Zitation wie "251/I"; damit zeigt parl_gegenstand den Stand im Verfahren (Ausschuss, Nationalrat, Bundesrat, Bundesgesetzblatt), Abstimmung und Dokumente. ' +
        'Quelle: offene Daten des Parlaments (CC BY 4.0).',
      inputSchema: {
        art: z.enum(['RV', 'ANTR', 'VOLKBG']).default('RV').describe('RV = Regierungsvorlage, ANTR = Antrag, VOLKBG = Volksbegehren'),
        gp: z
          .union([z.string().min(1).max(8), z.number().int().min(1).max(40)])
          .optional()
          .describe('Gesetzgebungsperiode: 28 oder "XXVIII"'),
        schlagwort: z.string().min(2).max(100).optional().describe('Amtliches Schlagwort, z. B. "Verwaltungsverfahren"'),
        gremium: z.enum(['NR', 'BR']).default('NR').describe('NR = Nationalrat, BR = Bundesrat'),
        limit: z.number().int().min(1).max(50).default(15).describe('Anzahl Treffer pro Aufruf'),
        offset: z.number().int().min(0).max(5000).default(0).describe('Treffer überspringen (Seiten)'),
      },
      outputSchema: listOutput(gegenstandItemSchema),
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (args) => {
      let gp: string | undefined;
      try {
        gp = args.gp === undefined ? undefined : parseLegisPeriod(args.gp);
      } catch (e) {
        return { isError: true, content: [{ type: 'text', text: (e as Error).message }] };
      }
      const query: GegenstaendeQuery = {
        gremium: args.gremium,
        art: args.art,
        limit: args.limit,
        offset: args.offset,
        ...(gp ? { gp } : {}),
        ...(args.schlagwort ? { schlagwort: args.schlagwort } : {}),
      };
      try {
        const result = await searchGegenstaende(client, query);
        return listResult(formatGegenstaende(result, query), result.total, query.offset, result.items);
      } catch (e) {
        if (e instanceof ParlamentError)
          return { isError: true, content: [{ type: 'text', text: `Das Parlament hat nicht geantwortet: ${e.message}` }] };
        throw e;
      }
    },
  );
}
