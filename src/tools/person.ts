import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { BASE_URL, HttpError, ParlamentError, type ParlamentClient } from '../client.js';
import { fetchSlice, PAGE_SIZE } from '../paging.js';
import { cleanText, htmlAttr, truncate } from '../text.js';
import { rowsToObjects, type FilterResponse, type PersonResponse } from '../types.js';
import { describeCurrent, fold, loadPersons, type Person } from './abgeordnete.js';

/** List id of the speeches of one person; body `{"PAD_INTERN":[id]}`. */
export const PERSON_REDEN_LIST_ID = 251;
const MAX_LIST = 12;

export type Resolved = { person: Person } | { error: string };

/** Resolve `pad_intern` or a name to one person; an ambiguous name returns the candidates instead of guessing. */
export async function resolvePerson(client: ParlamentClient, args: { pad_intern?: number | undefined; name?: string | undefined }): Promise<Resolved> {
  const all = await loadPersons(client);
  if (args.pad_intern !== undefined) {
    const p = all.find((x) => x.padIntern === args.pad_intern);
    return p ? { person: p } : { error: `Keine Person mit pad_intern ${args.pad_intern}. pad_intern steht in den Ergebnissen von parl_abgeordnete.` };
  }
  if (!args.name) return { error: 'Bitte pad_intern oder name angeben.' };
  const parts = fold(args.name).split(/\s+/).filter(Boolean);
  const hits = all.filter((p) => parts.every((part) => fold(p.name).includes(part)));
  if (hits.length === 0) return { error: `Keine Person zu "${args.name}" gefunden. Name ohne Titel versuchen oder parl_abgeordnete nutzen.` };
  const current = hits.filter((p) => p.aktuell);
  const pool = hits.length === 1 ? hits : current.length === 1 ? current : hits;
  if (pool.length === 1) return { person: pool[0]! };
  const list = pool.slice(0, 8).map((p) => `- ${p.name} — ${p.funktion ?? ''} (pad_intern ${p.padIntern})${p.aktuell ? ' · aktuell' : ''}`);
  return { error: `"${args.name}" ist nicht eindeutig (${pool.length} Treffer). Bitte pad_intern angeben:\n${list.join('\n')}${pool.length > 8 ? '\n…' : ''}` };
}

export function formatPerson(p: Person, d: PersonResponse): string {
  const c = d.content;
  const bio = c.biografie;
  const k = bio?.kurzbiografie;
  const lines: string[] = [cleanText(c.headingbox?.title_plain ?? c.headingbox?.title ?? p.name)];
  lines.push(p.funktion ? p.funktion : 'Keine Funktion angegeben');
  if (p.aktuell) lines.push(describeCurrent(p.aktuell));
  else lines.push(c.personInfo?.aktiv ? 'Derzeit aktiv (laut Parlament).' : 'Derzeit nicht im Amt (laut Parlament).');
  if (k?.gebtext) lines.push(cleanText(k.gebtext));

  const mandate = bio?.mandatefunktionen?.mandate ?? [];
  if (mandate.length) {
    lines.push('', 'Mandate und Funktionen:');
    for (const m of mandate.slice(0, MAX_LIST)) {
      lines.push(`- ${cleanText(m.bez ?? m.gremium ?? 'Mandat')}${m.zeitraum ? ` (${m.zeitraum})` : ''}${m.aktiv ? ' · aktiv' : ''}${m.wahlkreis ? ` · ${cleanText(m.wahlkreis)}` : ''}`);
    }
    if (mandate.length > MAX_LIST) lines.push(`- … und ${mandate.length - MAX_LIST} weitere`);
  }
  const section = (title: string, items: string[] | null | undefined) => {
    if (!items?.length) return;
    lines.push('', `${title}:`);
    for (const i of items.slice(0, MAX_LIST)) lines.push(`- ${truncate(cleanText(i), 220)}`);
    if (items.length > MAX_LIST) lines.push(`- … und ${items.length - MAX_LIST} weitere`);
  };
  section('Politische Funktionen', k?.politischeFunktionen);
  section('Beruflicher Werdegang', k?.beruflicherWerdegang);
  section('Bildungsweg', k?.bildungsweg);
  if (bio?.biografieStand) lines.push('', `Biografie-Stand: ${bio.biografieStand}. Angaben ab 1945 stammen laut Parlament von den Mandatarinnen und Mandataren selbst.`);
  lines.push(`Quelle: ${p.url}`, 'Reden dieser Person: parl_reden_person.');
  return lines.join('\n');
}

export interface RedeItem {
  gremium: 'NR' | 'BR';
  /** "XXVII" for the Nationalrat, "BR" for the Bundesrat. */
  gp: string;
  sitzung: number;
  datum: string | null;
  thema: string;
  protokollUrl: string | null;
}

export function parseReden(resp: FilterResponse): RedeItem[] {
  const items: RedeItem[] = [];
  for (const o of rowsToObjects(resp)) {
    const cell = String(o['Sitzung'] ?? '');
    const m = /\/sitzung\/([A-Za-z]+)\/(NRSITZ|BRSITZ)\/(\d+)/.exec(cell);
    if (!m) continue;
    const href = typeof o['col5'] === 'string' ? (htmlAttr(o['col5'], 'href') ?? null) : null;
    const date = typeof o['fromDate'] === 'string' ? /^(\d{4}-\d{2}-\d{2})/.exec(o['fromDate'])?.[1] : undefined;
    items.push({
      gremium: m[2] === 'BRSITZ' ? 'BR' : 'NR',
      gp: m[1]!,
      sitzung: Number(m[3]),
      datum: date ?? null,
      thema: cleanText(String(o['Rede'] ?? '')) || '(ohne Titel)',
      protokollUrl: href ? (href.startsWith('http') ? href : BASE_URL + href) : null,
    });
  }
  return items;
}

export function formatReden(who: Person, result: { total: number; items: RedeItem[] }, offset: number): string {
  if (result.total === 0) return `Keine Reden von ${who.name} im Plenarprotokoll gefunden (Reden gibt es für Abgeordnete mit Wortmeldungen im Plenum).`;
  if (result.items.length === 0) return `Keine Treffer ab offset=${offset}; es gibt insgesamt ${result.total}.`;
  const to = offset + result.items.length;
  const surname = who.name.split(/[ ,]/)[0] ?? who.name;
  const lines = [`${result.total} Reden von ${who.name}, neueste zuerst, angezeigt ${offset + 1}–${to}.${to < result.total ? ` Weitere mit offset=${to}.` : ''}`, ''];
  for (const r of result.items) {
    lines.push(`- ${r.datum ?? '?'} · ${r.sitzung}. Sitzung ${r.gremium === 'NR' ? `des Nationalrats (${r.gp}. GP)` : 'des Bundesrats'} · ${truncate(r.thema, 200)}`);
    if (r.protokollUrl) lines.push(`  Protokoll: ${r.protokollUrl}`);
    lines.push(`  Text: parl_sitzung gremium=${r.gremium}${r.gremium === 'NR' ? ` gp=${r.gp}` : ''} nummer=${r.sitzung} redner="${surname}" → rede-Nummer → parl_rede`);
  }
  return lines.join('\n');
}

export async function searchReden(client: ParlamentClient, pad: number, offset: number, limit: number) {
  return fetchSlice(offset, limit, async (page) => {
    const resp = await client.filterDataPost(PERSON_REDEN_LIST_ID, { PAD_INTERN: [String(pad)] }, { page, pagesize: PAGE_SIZE, sortrnr: 10, ascDesc: 'DESC' });
    return { total: resp.count, rows: parseReden(resp), rawRows: resp.rows.length };
  });
}

const personArgs = {
  pad_intern: z.number().int().min(1).optional().describe('Nummer der Person aus parl_abgeordnete'),
  name: z.string().min(2).max(100).optional().describe('Name, falls pad_intern unbekannt (bei Mehrdeutigkeit werden Kandidaten genannt)'),
};

export function registerPerson(server: McpServer, client: ParlamentClient): void {
  const fail = (text: string) => ({ isError: true as const, content: [{ type: 'text' as const, text }] });
  const apiFail = (e: unknown) => {
    if (e instanceof HttpError && e.status === 404) return fail('Die Seite wurde nicht gefunden.');
    if (e instanceof ParlamentError) return fail(`Das Parlament hat nicht geantwortet: ${e.message}`);
    throw e;
  };

  server.registerTool(
    'parl_person',
    {
      title: 'Lebenslauf und Mandate einer Person im Parlament',
      description:
        'Zeigt zu einer Person (pad_intern oder Name) die Mandate und Funktionen mit Zeiträumen, den Klub, ob sie aktuell im Amt ist, sowie Kurzbiografie ' +
        '(Geburt, politische Funktionen, Werdegang, Bildung) laut Parlament. Die Biografien beruhen ab 1945 auf Angaben der Mandatarinnen und Mandatare selbst. ' +
        'Quelle: offene Daten des Parlaments (CC BY 4.0).',
      inputSchema: personArgs,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (args) => {
      try {
        const r = await resolvePerson(client, args);
        if ('error' in r) return fail(r.error);
        return { content: [{ type: 'text' as const, text: formatPerson(r.person, await client.person(r.person.padIntern)) }] };
      } catch (e) {
        return apiFail(e);
      }
    },
  );

  server.registerTool(
    'parl_reden_person',
    {
      title: 'Alle Plenarreden einer Person auflisten',
      description:
        'Listet die Reden einer Person im Plenum von Nationalrat und Bundesrat, neueste zuerst: Datum, Sitzung, Thema und Link zum Protokoll. ' +
        'Den Text einer Rede liefert danach parl_sitzung (mit redner=) und parl_rede. Quelle: offene Daten des Parlaments (CC BY 4.0).',
      inputSchema: {
        ...personArgs,
        limit: z.number().int().min(1).max(50).default(10).describe('Anzahl Reden pro Aufruf'),
        offset: z.number().int().min(0).max(5000).default(0).describe('Reden überspringen (Seiten)'),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (args) => {
      try {
        const r = await resolvePerson(client, args);
        if ('error' in r) return fail(r.error);
        const offset = args.offset ?? 0;
        const result = await searchReden(client, r.person.padIntern, offset, args.limit ?? 10);
        return { content: [{ type: 'text' as const, text: formatReden(r.person, result, offset) }] };
      } catch (e) {
        return apiFail(e);
      }
    },
  );
}
