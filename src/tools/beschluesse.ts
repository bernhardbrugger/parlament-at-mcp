import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { BASE_URL, HttpError, ParlamentError, type ParlamentClient } from '../client.js';
import { cleanText, fold, truncate } from '../text.js';
import type { Resolution, Session } from '../types.js';
import { sitzungPath } from './sitzung.js';

const MAX_CHARS = 20_000;

/** One stage as a single line: line breaks of the HTML become " · ", links lose their markup. */
export function stageText(html: string): string {
  return html
    .split(/<br\s*\/?>/i)
    .map((part) => cleanText(part))
    .filter(Boolean)
    .join(' · ');
}

interface Decision {
  date: string | null;
  text: string;
}

/** Date "16.06.2025" -> sortable number, so stages after the session can be told from those before. */
function dateKey(d: string | null | undefined): number {
  const m = d ? /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(d) : null;
  return m ? Number(`${m[3]}${m[2]}${m[1]}`) : 0;
}

/**
 * Split the stages of one agenda item into what the plenary decided in THIS session and what came after
 * (typically the Bundesrat). Committee stages are left out: parl_gegenstand shows the full procedure.
 */
export function splitStages(r: Resolution, sessionNumber: number, sessionDate: string | null) {
  const marker = new RegExp(`(^|[^0-9])${sessionNumber}\\. Sitzung des (Nationalrat|Bundesrat)`);
  const plenary: Decision[] = [];
  const later: Decision[] = [];
  const seen = new Set<string>();
  for (const material of r.materials ?? []) {
    for (const s of material.stages ?? []) {
      const text = stageText(s.text);
      const key = `${s.date}|${text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (marker.test(text)) plenary.push({ date: s.date ?? null, text });
      else if (sessionDate && dateKey(s.date) > dateKey(sessionDate) && /Sitzung/.test(text) && !/ausschuss/i.test(text))
        later.push({ date: s.date ?? null, text });
    }
  }
  return { plenary, later };
}

export function formatBeschluesse(session: Session, sessionNumber: number, path: string, filter: { top?: string } = {}): string {
  const lines: string[] = [session.title];
  const items = session.resolutions.filter((r) => !filter.top || fold(`${r.top ?? ''} ${r.text ?? ''}`).includes(fold(filter.top)));
  if (session.resolutions.length === 0) {
    lines.push('', 'Zu dieser Sitzung liegen (noch) keine Beschlüsse vor. Sie erscheinen, sobald abgestimmt wurde.');
  } else if (items.length === 0) {
    lines.push('', `Kein Tagesordnungspunkt passt zu "${filter.top}". Es gibt ${session.resolutions.length} Punkte mit Beschlüssen.`);
  } else {
    const sessionDate = session.start ? `${session.start.slice(8, 10)}.${session.start.slice(5, 7)}.${session.start.slice(0, 4)}` : null;
    lines.push(`${items.length} von ${session.resolutions.length} Tagesordnungspunkten mit Beschlüssen:`);
    for (const r of items) {
      lines.push('', `${r.top ?? 'TOP'} — ${truncate(cleanText(r.text ?? ''), 220)}${r.zitation ? ` (${cleanText(r.zitation)})` : ''}`);
      if (r.url) lines.push(`  ${BASE_URL}${r.url}`);
      const { plenary, later } = splitStages(r, sessionNumber, sessionDate);
      for (const d of plenary) lines.push(`  ✔ ${d.text}`);
      if (plenary.length === 0) lines.push('  (kein Plenarbeschluss in dieser Sitzung verzeichnet)');
      for (const d of later) lines.push(`  danach (${d.date ?? '?'}): ${d.text}`);
    }
  }
  if (session.correspondence.length) {
    lines.push('', 'Parlamentskorrespondenz zur Sitzung:');
    for (const c of session.correspondence.slice(0, 8))
      lines.push(`- ${c.date ? c.date + ': ' : ''}${cleanText(c.title)} — ${BASE_URL}${c.url}`);
  }
  const agenda = session.agenda.flatMap((a) =>
    a.links.filter((l) => l.type?.toUpperCase() === 'HTML').map((l) => `- ${cleanText(a.title)}: ${BASE_URL}${l.link}`),
  );
  if (agenda.length) lines.push('', 'Tagesordnung und Unterlagen:', ...agenda.slice(0, 8));
  lines.push(
    '',
    'Details zu einem Gegenstand (Verfahren, Ausschuss, Dokumente): parl_gegenstand mit gp und Zitation.',
    `Quelle: ${BASE_URL}${path}`,
  );
  const text = lines.join('\n');
  return text.length > MAX_CHARS ? text.slice(0, MAX_CHARS).replace(/\n[^\n]*$/, '') + '\n[… gekürzt; mit top= eingrenzen]' : text;
}

export function registerBeschluesse(server: McpServer, client: ParlamentClient): void {
  server.registerTool(
    'parl_beschluesse',
    {
      title: 'Was wurde in einer Plenarsitzung beschlossen?',
      description:
        'Zeigt zu einer Plenarsitzung des Nationalrats (gremium NR, gp, Sitzungsnummer) oder Bundesrats (BR) pro Tagesordnungspunkt, was beschlossen oder abgelehnt wurde, ' +
        'mit Abstimmungsergebnis nach Parteien (Dafür/Dagegen) und dem weiteren Weg (z. B. Bundesrat). Dazu Links zur Tagesordnung und zur Parlamentskorrespondenz. ' +
        'Mit top= (Teil des Titels oder "TOP 3") eingrenzen. Sitzungsnummern liefert parl_sitzungen. Quelle: offene Daten des Parlaments (CC BY 4.0).',
      inputSchema: {
        gremium: z.enum(['NR', 'BR']).default('NR').describe('NR = Nationalrat, BR = Bundesrat'),
        gp: z
          .union([z.string().min(1).max(8), z.number().int().min(1).max(40)])
          .optional()
          .describe('Gesetzgebungsperiode (nur Nationalrat)'),
        nummer: z.number().int().min(1).max(9999).describe('Sitzungsnummer, z. B. 30'),
        top: z.string().min(2).max(80).optional().describe('Nur passende Tagesordnungspunkte, z. B. "TOP 2" oder "Budget"'),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (args) => {
      const fail = (text: string) => ({ isError: true as const, content: [{ type: 'text' as const, text }] });
      let path: string;
      try {
        path = sitzungPath(args.gremium ?? 'NR', args.gp, args.nummer);
      } catch (e) {
        return fail((e as Error).message);
      }
      try {
        const session = await client.session(path);
        return {
          content: [{ type: 'text' as const, text: formatBeschluesse(session, args.nummer, path, args.top ? { top: args.top } : {}) }],
        };
      } catch (e) {
        if (e instanceof HttpError && e.status === 404)
          return fail(`Keine Sitzung unter ${path} gefunden (parl_sitzungen listet die Nummern).`);
        if (e instanceof ParlamentError) return fail(`Das Parlament hat nicht geantwortet: ${e.message}`);
        throw e;
      }
    },
  );
}
