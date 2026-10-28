import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { BASE_URL, type ParlamentClient } from '../client.js';
import { rowsToObjects } from '../types.js';

/** List id of "all persons who ever sat in the Parliament" (Nationalrat, Bundesrat, government, ...). */
export const PERSONS_LIST_ID = 10400;
const PERSONS_TTL_MS = 6 * 3600 * 1000;

export interface Person {
  padIntern: number;
  name: string;
  funktion: string | null;
  /** Bodies the person belonged to, e.g. NR (Nationalrat), BR (Bundesrat), BuREG (Bundesregierung). */
  gremien: string[];
  geschlecht: 'M' | 'W' | null;
  url: string;
  portraitUrl: string | null;
}

/** Fold case and strip diacritics so "Ostermayer", "OSTERMAYER" and "Östermayer" all match. */
export function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/ß/g, 'ss')
    .toLowerCase()
    .trim();
}

/**
 * The API embeds HTML in text fields, e.g. "Arpa Claudia, Mag.<sup>a</sup>" for the title "Mag.a".
 * Keep the text of such markup and drop the tags.
 */
export function cleanText(s: string): string {
  return s
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseGremien(raw: unknown): string[] {
  if (typeof raw !== 'string') return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? [...new Set(parsed.filter((x): x is string => typeof x === 'string'))] : [];
  } catch {
    return [];
  }
}

export async function loadPersons(client: ParlamentClient): Promise<Person[]> {
  return client.cached('persons', PERSONS_TTL_MS, async () => {
    const resp = await client.filterData(PERSONS_LIST_ID);
    const persons: Person[] = [];
    for (const o of rowsToObjects(resp)) {
      const pad = Number(o['pad_intern']);
      const name = typeof o['Name'] === 'string' ? cleanText(o['Name']) : '';
      if (!Number.isInteger(pad) || !name) continue;
      const portrait = typeof o['portrait'] === 'string' && o['portrait'] ? o['portrait'] : null;
      const funktion = typeof o['Funktion'] === 'string' ? cleanText(o['Funktion']) : '';
      persons.push({
        padIntern: pad,
        name,
        funktion: funktion || null,
        gremien: parseGremien(o['persart']),
        geschlecht: o['geschl'] === 'M' || o['geschl'] === 'W' ? o['geschl'] : null,
        url: `${BASE_URL}/person/${pad}`,
        portraitUrl: portrait ? BASE_URL + portrait : null,
      });
    }
    return persons;
  });
}

export interface PersonQuery {
  name?: string;
  gremium?: string;
  funktion?: string;
  limit: number;
  offset: number;
}

export function searchPersons(all: Person[], q: PersonQuery): { total: number; items: Person[] } {
  const name = q.name ? fold(q.name).split(/\s+/).filter(Boolean) : [];
  const funktion = q.funktion ? fold(q.funktion) : '';
  const gremium = q.gremium?.trim().toLowerCase();
  const hits = all.filter(
    (p) =>
      name.every((part) => fold(p.name).includes(part)) &&
      (!funktion || fold(p.funktion ?? '').includes(funktion)) &&
      (!gremium || p.gremien.some((g) => g.toLowerCase() === gremium)),
  );
  return { total: hits.length, items: hits.slice(q.offset, q.offset + q.limit) };
}

export function formatPersons(result: { total: number; items: Person[] }, q: PersonQuery): string {
  if (result.total === 0) {
    return 'Keine Personen gefunden. Tipp: Namen ohne Titel suchen ("Rendi-Wagner"), Gremium als Kürzel (NR, BR, BuREG).';
  }
  const lines = result.items.map((p) => {
    const body = p.gremien.length ? ` [${p.gremien.join(', ')}]` : '';
    return `- ${p.name} — ${p.funktion ?? 'keine Funktion angegeben'}${body}\n  ${p.url} (pad_intern ${p.padIntern})`;
  });
  const from = q.offset + 1;
  const to = q.offset + result.items.length;
  const more = to < result.total ? ` Weitere Treffer mit offset=${to}.` : '';
  return `${result.total} Treffer, angezeigt ${from}–${to}.${more}\n\n${lines.join('\n')}`;
}

export function registerAbgeordnete(server: McpServer, client: ParlamentClient): void {
  server.registerTool(
    'parl_abgeordnete',
    {
      title: 'Personen im österreichischen Parlament suchen',
      description:
        'Sucht Personen, die dem österreichischen Parlament angehört haben oder angehören (Nationalrat, Bundesrat, Bundesregierung u. a.), ' +
        'nach Name, Gremium und Funktion. Quelle: offene Daten des Parlaments (CC BY 4.0). ' +
        'Die Liste umfasst auch frühere Mitglieder; ob jemand aktuell im Amt ist, steht nur im Feld "funktion" und auf der Detailseite (url). ' +
        'Gremium-Kürzel: NR Nationalrat, BR Bundesrat, BuREG Bundesregierung, BV Bundesversammlung, MEP EU-Parlament, LH Landeshauptleute, ' +
        'KN/PN Konstituierende/Provisorische Nationalversammlung, MPO Mitglieder des Präsidiums/Ordnungsorgane.',
      inputSchema: {
        name: z.string().min(1).max(100).optional().describe('Name oder Namensteile, ohne Titel, Groß-/Kleinschreibung und Umlaute egal'),
        gremium: z.string().min(1).max(10).optional().describe('Gremium-Kürzel, z. B. NR, BR, BuREG'),
        funktion: z.string().min(1).max(100).optional().describe('Teil der Funktionsbezeichnung, z. B. "Bundesminister" oder "Klubobmann"'),
        limit: z.number().int().min(1).max(100).default(20).describe('Maximale Anzahl Treffer'),
        offset: z.number().int().min(0).default(0).describe('Treffer überspringen (für Seiten)'),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (args) => {
      const query: PersonQuery = { ...args, limit: args.limit ?? 20, offset: args.offset ?? 0 };
      const result = searchPersons(await loadPersons(client), query);
      return { content: [{ type: 'text', text: formatPersons(result, query) }] };
    },
  );
}
