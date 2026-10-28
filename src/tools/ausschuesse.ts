import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { BASE_URL, HttpError, ParlamentError, type ParlamentClient } from '../client.js';
import { parseLegisPeriod } from '../legis-period.js';
import { cleanText, fold, truncate } from '../text.js';
import { rowsToObjects, type DetailResponse, type FilterResponse } from '../types.js';

/** `FBEZ` of the committee list; body `{"NRBR":["NR"],"GP":["XXVIII"]}`. */
export const AUSSCHUESSE_FBEZ = 'WFP_009';
/** More committees than this get listed without detail pages (each detail is one request). */
export const MAX_DETAILS = 3;
const PATH_RE = /^\/ausschuss\/(?:[IVXL]{1,8}|BR)\/[A-Z0-9-]+\/\d+\/\d+$/;

export interface AusschussItem {
  name: string;
  /** As printed by the Parliament, two-digit year, e.g. "26.02.25". */
  seit: string | null;
  path: string | null;
  url: string | null;
}

export function parseAusschuesse(resp: FilterResponse): AusschussItem[] {
  const items: AusschussItem[] = [];
  for (const o of rowsToObjects(resp)) {
    const name = typeof o['Ausschuss'] === 'string' ? cleanText(o['Ausschuss']) : '';
    if (!name) continue;
    const raw = typeof o['link'] === 'string' ? o['link'].split('#')[0]! : '';
    const path = PATH_RE.test(raw) ? raw : null;
    items.push({ name, seit: typeof o['aus_von'] === 'string' ? o['aus_von'] : null, path, url: path ? BASE_URL + path : null });
  }
  return items;
}

export function filterAusschuesse(items: AusschussItem[], suche?: string): AusschussItem[] {
  const q = suche ? fold(suche) : '';
  return q ? items.filter((i) => fold(i.name).includes(q)) : items;
}

function link(l: string): string {
  return l.startsWith('http') ? l : BASE_URL + l;
}

export function formatAusschussDetail(item: AusschussItem, d: DetailResponse): string {
  const c = d.content;
  const lines = [`${cleanText(c.title ?? item.name)}${item.seit ? ` (eingesetzt ${item.seit})` : ''}`];
  if (c.description) lines.push(truncate(cleanText(c.description), 600));
  if (c.names?.length) {
    lines.push('', 'Vorsitz:');
    for (const n of c.names)
      lines.push(
        `- ${n.funktext ?? 'Mitglied'}: ${cleanText(n.name)}${n.frak_code ? ` (${n.frak_code})` : ''}${n.url ? ` — ${link(n.url)}` : ''}`,
      );
  }
  const agenda = (c.recentagenda ?? []).filter((a) => a.title && a.documents?.length);
  if (agenda.length) {
    lines.push('', 'Letzte Tagesordnungen:');
    for (const a of agenda.slice(0, 3)) {
      const doc = a.documents!.find((x) => x.type?.toUpperCase() === 'HTML') ?? a.documents![0]!;
      lines.push(`- ${cleanText(a.title!)}: ${link(doc.link)}`);
    }
  }
  const assigned = (c.assignments?.data?.links ?? []).filter((x) => x.title && x.link);
  if (assigned.length) {
    lines.push('', `Zugewiesene Gegenstände (die ${Math.min(assigned.length, 8)} ersten von ${assigned.length}):`);
    for (const a of assigned.slice(0, 8)) lines.push(`- ${truncate(cleanText(a.title!), 200)} — ${link(a.link!)}`);
  }
  lines.push('', `Quelle: ${item.url ?? BASE_URL}`);
  return lines.join('\n');
}

export function formatAusschussListe(items: AusschussItem[], gp: string | undefined): string {
  if (items.length === 0) return 'Keine Ausschüsse gefunden. Tipp: Namensteil kürzer wählen oder die Gesetzgebungsperiode prüfen.';
  const lines = [`${items.length} Ausschüsse${gp ? ` der ${gp}. GP` : ''}:`, ''];
  for (const i of items) lines.push(`- ${i.name}${i.seit ? ` (seit ${i.seit})` : ''}${i.url ? `\n  ${i.url}` : ''}`);
  lines.push(
    '',
    `Mit suche= auf bis zu ${MAX_DETAILS} Ausschüsse eingrenzen, dann kommen Vorsitz, Tagesordnungen und zugewiesene Gegenstände dazu.`,
  );
  return lines.join('\n');
}

export function registerAusschuesse(server: McpServer, client: ParlamentClient): void {
  server.registerTool(
    'parl_ausschuesse',
    {
      title: 'Ausschüsse des Nationalrats oder Bundesrats',
      description:
        'Listet die Ausschüsse einer Gesetzgebungsperiode (Nationalrat: gp nötig, z. B. 28 oder "XXVIII"; Bundesrat: ohne gp). ' +
        `Mit suche= (Namensteil, z. B. "Finanz") eingegrenzt auf höchstens ${MAX_DETAILS} Treffer zeigt es zusätzlich Vorsitz (Obleute mit Partei), ` +
        'Aufgabenbeschreibung, letzte Tagesordnungen und zugewiesene Gegenstände. Quelle: offene Daten des Parlaments (CC BY 4.0).',
      inputSchema: {
        gremium: z.enum(['NR', 'BR']).default('NR').describe('NR = Nationalrat, BR = Bundesrat'),
        gp: z
          .union([z.string().min(1).max(8), z.number().int().min(1).max(40)])
          .optional()
          .describe('Gesetzgebungsperiode (Nationalrat)'),
        suche: z.string().min(2).max(60).optional().describe('Teil des Ausschussnamens'),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (args) => {
      const fail = (text: string) => ({ isError: true as const, content: [{ type: 'text' as const, text }] });
      const gremium = args.gremium;
      let gp: string | undefined;
      try {
        gp = args.gp === undefined ? undefined : parseLegisPeriod(args.gp);
      } catch (e) {
        return fail((e as Error).message);
      }
      if (gremium === 'NR' && !gp) return fail('Für den Nationalrat ist die Gesetzgebungsperiode (gp) nötig, z. B. 28 oder "XXVIII".');
      try {
        const body: Record<string, string[]> = { NRBR: [gremium] };
        if (gp) body['GP'] = [gp];
        const all = parseAusschuesse(await client.filterPost(AUSSCHUESSE_FBEZ, body, { all: true }));
        const hits = filterAusschuesse(all, args.suche);
        if (args.suche && hits.length > 0 && hits.length <= MAX_DETAILS) {
          const parts: string[] = [];
          for (const item of hits) {
            if (!item.path) {
              parts.push(item.name);
              continue;
            }
            parts.push(formatAusschussDetail(item, await client.detail(item.path)));
          }
          return { content: [{ type: 'text' as const, text: parts.join('\n\n----------\n\n') }] };
        }
        return { content: [{ type: 'text' as const, text: formatAusschussListe(hits, gp) }] };
      } catch (e) {
        if (e instanceof HttpError && e.status === 404) return fail('Die Ausschussseite wurde nicht gefunden.');
        if (e instanceof ParlamentError) return fail(`Das Parlament hat nicht geantwortet: ${e.message}`);
        throw e;
      }
    },
  );
}
