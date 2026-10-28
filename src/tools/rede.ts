import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { BASE_URL, HttpError, ParlamentError, type ParlamentClient } from '../client.js';
import { parseSpeechHtml, windowText } from '../speech.js';
import { cleanText } from '../text.js';
import type { Session } from '../types.js';
import { sitzungPath } from './sitzung.js';

/** Clients drop tool results above roughly this size (measured by ris-mcp-ts for Claude Code: 45,000). */
export const HARD_LIMIT_CHARS = 45_000;
export const DEFAULT_CHARS = 30_000;

export interface Located {
  speaker: string;
  time: string | null;
  top: string;
  htmlPath: string;
  autorisiert: boolean | null;
}

/** Find a speech (or any protocol entry) by its `st_objekte_id` and return where its HTML segment lives. */
export function locateSpeech(session: Session, id: number): Located | null {
  for (const entry of session.progress) {
    const candidates = [
      ...(entry.speeches ?? []).map((s) => ({
        id: s.st_objekte_id,
        speaker: s.texta,
        time: s.time,
        protocol: s.protocol,
        auto: s.autorisiert,
      })),
      ...(entry.st_objekte_id !== undefined
        ? [{ id: entry.st_objekte_id, speaker: entry.text, time: entry.time, protocol: entry.protocol, auto: undefined }]
        : []),
    ];
    for (const c of candidates) {
      if (c.id !== id) continue;
      const html = c.protocol?.data.links.flatMap((l) => l.documents ?? []).find((d) => d.type?.toUpperCase() === 'HTML');
      if (!html) return null;
      return {
        speaker: cleanText(c.speaker),
        time: c.time ?? null,
        top: cleanText(entry.text),
        htmlPath: html.link,
        autorisiert: c.auto ?? null,
      };
    }
  }
  return null;
}

export function formatRede(args: {
  located: Located;
  sessionTitle: string;
  protocolNote: string | null;
  html: string;
  interjections: boolean;
  offset: number;
  maxChars: number;
}): string {
  const speech = parseSpeechHtml(args.html, { interjections: args.interjections });
  const full = speech.paragraphs.join('\n\n');
  const win = windowText(full, args.offset, args.maxChars);
  const times = speech.start
    ? ` · ${speech.start}${speech.end ? `–${speech.end}` : ''}`
    : args.located.time
      ? ` · ${args.located.time}`
      : '';
  const lines = [`${speech.speaker ?? args.located.speaker}${times}`, `${args.sessionTitle} · ${args.located.top}`];
  if (args.located.autorisiert === false) lines.push('Hinweis: Dieser Redebeitrag ist laut Parlament noch nicht autorisiert.');
  if (args.protocolNote) lines.push(`Hinweis des Parlaments: ${cleanText(args.protocolNote)}`);
  lines.push(`Quelle: ${BASE_URL}${args.located.htmlPath}`, '');
  if (win.total === 0) {
    lines.push('(Der Redebeitrag enthält keinen Text.)');
  } else {
    lines.push(win.text);
    lines.push(
      '',
      win.to < win.total
        ? `[Zeichen ${win.from + 1}–${win.to} von ${win.total}; weiterlesen mit offset=${win.to}]`
        : `[Ende der Rede, ${win.total} Zeichen${args.interjections ? '' : ', ohne Zwischenrufe'}]`,
    );
  }
  return lines.join('\n');
}

export function registerRede(server: McpServer, client: ParlamentClient): void {
  server.registerTool(
    'parl_rede',
    {
      title: 'Eine einzelne Rede aus dem Plenarprotokoll lesen',
      description:
        'Liefert den Text EINES Redebeitrags aus dem stenographischen Protokoll (Sitzung wie bei parl_sitzung, dazu die rede-Nummer aus deren Ergebnis). ' +
        'Zwischenrufe und Beifall stehen standardmäßig im Text; mit zwischenrufe=false werden sie weggelassen. ' +
        `Lange Reden werden in Stücken von höchstens ${HARD_LIMIT_CHARS.toLocaleString('de-AT')} Zeichen geliefert (offset zum Weiterlesen). ` +
        'Zitate immer mit Redner, Sitzung und der Quellangabe aus dem Ergebnis belegen. Quelle: offene Daten des Parlaments (CC BY 4.0).',
      inputSchema: {
        gremium: z.enum(['NR', 'BR']).default('NR').describe('NR = Nationalrat, BR = Bundesrat'),
        gp: z
          .union([z.string().min(1).max(8), z.number().int().min(1).max(40)])
          .optional()
          .describe('Gesetzgebungsperiode (nur Nationalrat)'),
        nummer: z.number().int().min(1).max(9999).describe('Sitzungsnummer'),
        rede: z.number().int().min(1).describe('Nummer des Redebeitrags (rede=...) aus parl_sitzung'),
        zwischenrufe: z.boolean().default(true).describe('Zwischenrufe und Beifall mitliefern'),
        offset: z.number().int().min(0).default(0).describe('Ab diesem Zeichen weiterlesen'),
        max_zeichen: z.number().int().min(1000).max(HARD_LIMIT_CHARS).default(DEFAULT_CHARS).describe('Größe des gelieferten Stücks'),
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
        const located = locateSpeech(session, args.rede);
        if (!located)
          return fail(`Kein Redebeitrag mit rede=${args.rede} in dieser Sitzung. Die Nummern stehen im Ergebnis von parl_sitzung.`);
        const html = await client.document(located.htmlPath);
        const text = formatRede({
          located,
          sessionTitle: session.title,
          protocolNote: session.protocolNote,
          html,
          interjections: args.zwischenrufe ?? true,
          offset: args.offset ?? 0,
          maxChars: args.max_zeichen ?? DEFAULT_CHARS,
        });
        return { content: [{ type: 'text' as const, text }] };
      } catch (e) {
        if (e instanceof HttpError && e.status === 404) return fail(`Sitzung oder Dokument nicht gefunden (${path}).`);
        if (e instanceof ParlamentError) return fail(`Das Parlament hat nicht geantwortet: ${e.message}`);
        throw e;
      }
    },
  );
}
