import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { BASE_URL, HttpError, ParlamentError, type ParlamentClient } from '../client.js';
import { parseLegisPeriod } from '../legis-period.js';
import { cleanText, fold } from '../text.js';
import type { Session } from '../types.js';

/** Outline output is capped so a long session never floods the model's context. */
const MAX_OUTLINE_CHARS = 20_000;
/** Without a filter, speeches are listed only for sessions with at most this many. */
const LIST_ALL_SPEECHES_UP_TO = 40;

export type Gremium = 'NR' | 'BR';

export function sitzungPath(gremium: Gremium, gp: string | number | undefined, nummer: number): string {
  if (gremium === 'BR') return `/gegenstand/BR/BRSITZ/${nummer}`;
  if (gp === undefined) throw new Error('Für den Nationalrat ist die Gesetzgebungsperiode (gp) nötig, z. B. 28 oder "XXVIII".');
  return `/gegenstand/${parseLegisPeriod(gp)}/NRSITZ/${nummer}`;
}

export interface OutlineFilter {
  top?: string;
  redner?: string;
}

export function formatSitzung(session: Session, path: string, filter: OutlineFilter = {}): string {
  const lines: string[] = [session.title];
  lines.push(
    [session.zitation, session.gp && `${session.gp}. GP`, session.state && `Status: ${session.state}`].filter(Boolean).join(' · '),
  );
  if (session.start) lines.push(`Beginn ${session.start.replace('T', ' ')}${session.end ? `, Ende ${session.end.replace('T', ' ')}` : ''}`);

  const protocols = session.protocols.flatMap((p) =>
    p.links.map((l) => `- ${p.title}${l.type ? ` (${l.type})` : ''}: ${BASE_URL}${l.link}`),
  );
  if (protocols.length) lines.push('', 'Gesamtes Protokoll (sehr lang, besser einzelne Reden mit parl_rede):', ...protocols);
  if (session.protocolNote) lines.push('', `Hinweis des Parlaments: ${cleanText(session.protocolNote)}`);

  const top = filter.top ? fold(filter.top) : '';
  const redner = filter.redner ? fold(filter.redner) : '';
  const entries = session.progress.filter((p) => !top || fold(p.text).includes(top));
  const speechCount = entries.reduce((n, e) => n + (e.speeches?.length ?? 0), 0);
  const listSpeeches = Boolean(redner) || Boolean(top) || speechCount <= LIST_ALL_SPEECHES_UP_TO;

  lines.push('', `Verlauf (${entries.length} Punkte, ${speechCount} Redebeiträge):`);
  let shown = 0;
  for (const e of entries) {
    const speeches = e.speeches ?? [];
    const matching = redner ? speeches.filter((s) => fold(s.texta).includes(redner)) : speeches;
    if (redner && matching.length === 0) continue;
    const refs = e.speeches === undefined && e.st_objekte_id !== undefined ? ` · rede=${e.st_objekte_id}` : '';
    lines.push(`${e.time ?? '--:--:--'}  ${cleanText(e.text)}${speeches.length ? ` — ${speeches.length} Redebeiträge` : ''}${refs}`);
    if (listSpeeches) {
      for (const s of matching) lines.push(`    ${s.time ?? ''}  ${cleanText(s.texta)} · rede=${s.st_objekte_id}`);
    }
    shown++;
  }
  if (redner && shown === 0) lines.push(`Keine Wortmeldung von "${filter.redner}" in dieser Sitzung.`);
  const footer = [''];
  if (!listSpeeches) footer.push('Redebeiträge einzeln sehen: mit top= (Teil des Tagesordnungspunkts) oder redner= (Name) eingrenzen.');
  footer.push('Eine Rede lesen: parl_rede mit derselben Sitzung und der rede-Nummer.', `Quelle: ${BASE_URL}${path}`);
  const footerText = footer.join('\n');

  let body = lines.join('\n');
  const room = MAX_OUTLINE_CHARS - footerText.length - 1;
  if (body.length > room) {
    body = body.slice(0, room).replace(/\n[^\n]*$/, '') + '\n[… gekürzt; mit top= oder redner= eingrenzen]';
  }
  return body + '\n' + footerText;
}

export function registerSitzung(server: McpServer, client: ParlamentClient): void {
  server.registerTool(
    'parl_sitzung',
    {
      title: 'Verlauf einer Plenarsitzung: Tagesordnungspunkte und Redner',
      description:
        'Zeigt eine Plenarsitzung des Nationalrats (gremium NR, gp und Sitzungsnummer) oder Bundesrats (gremium BR, Nummer): ' +
        'Beginn/Ende, Link zum gesamten Protokoll und den Verlauf mit Uhrzeit, Tagesordnungspunkten und - bei Debatten - allen Redebeiträgen ' +
        'mit Name, Partei und der Nummer (rede=...), die parl_rede braucht. Mit redner= (Name) zeigt es nur die Beiträge dieser Person, ' +
        'mit top= nur passende Tagesordnungspunkte. Sitzungsnummern liefert parl_sitzungen. Quelle: offene Daten des Parlaments (CC BY 4.0).',
      inputSchema: {
        gremium: z.enum(['NR', 'BR']).default('NR').describe('NR = Nationalrat, BR = Bundesrat'),
        gp: z
          .union([z.string().min(1).max(8), z.number().int().min(1).max(40)])
          .optional()
          .describe('Gesetzgebungsperiode (nur Nationalrat)'),
        nummer: z.number().int().min(1).max(9999).describe('Sitzungsnummer, z. B. 30'),
        redner: z.string().min(2).max(80).optional().describe('Nur Wortmeldungen dieser Person (Name oder Teil davon)'),
        top: z.string().min(2).max(80).optional().describe('Nur Tagesordnungspunkte, deren Titel das enthält'),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (args) => {
      let path: string;
      try {
        path = sitzungPath(args.gremium, args.gp, args.nummer);
      } catch (e) {
        return { isError: true, content: [{ type: 'text', text: (e as Error).message }] };
      }
      try {
        const session = await client.session(path);
        return {
          content: [
            {
              type: 'text',
              text: formatSitzung(session, path, {
                ...(args.top ? { top: args.top } : {}),
                ...(args.redner ? { redner: args.redner } : {}),
              }),
            },
          ],
        };
      } catch (e) {
        if (e instanceof HttpError && e.status === 404) {
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: `Keine Sitzung unter ${path} gefunden. Nummer und Gesetzgebungsperiode prüfen (parl_sitzungen listet sie).`,
              },
            ],
          };
        }
        if (e instanceof ParlamentError)
          return { isError: true, content: [{ type: 'text', text: `Das Parlament hat nicht geantwortet: ${e.message}` }] };
        throw e;
      }
    },
  );
}
