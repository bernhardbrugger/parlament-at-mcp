import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { BASE_URL, ParlamentError, type ParlamentClient } from '../client.js';
import { cleanText, fold, htmlAttr } from '../text.js';
import { listOutput, listResult, personItemSchema } from '../output.js';
import { rowsToObjects } from '../types.js';

/** List id of "all persons who ever sat in the Parliament" (Nationalrat, Bundesrat, government, ...). */
export const PERSONS_LIST_ID = 10400;
/** `FBEZ` of the current members of the Nationalrat / the Bundesrat. */
export const CURRENT_NR_FBEZ = 'WFW_002';
export const CURRENT_BR_FBEZ = 'WFW_005';
const PERSONS_TTL_MS = 6 * 3600 * 1000;
const CURRENT_TTL_MS = 3600 * 1000;

/** Who is in office right now, from the lists of current members. */
export interface CurrentInfo {
  gremium: 'NR' | 'BR';
  klub: string | null;
  wahlkreis: string | null;
  bundesland: string | null;
}

export interface Person {
  padIntern: number;
  name: string;
  funktion: string | null;
  /** Bodies the person belonged to, e.g. NR (Nationalrat), BR (Bundesrat), BuREG (Bundesregierung). */
  gremien: string[];
  geschlecht: 'M' | 'W' | null;
  url: string;
  portraitUrl: string | null;
  /** Set when the person is a current member of the Nationalrat or Bundesrat. */
  aktuell: CurrentInfo | null;
}

export { cleanText, fold };

function parseGremien(raw: unknown): string[] {
  if (typeof raw !== 'string') return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? [...new Set(parsed.filter((x): x is string => typeof x === 'string'))] : [];
  } catch {
    return [];
  }
}

const str = (v: unknown): string | null => (typeof v === 'string' && cleanText(v) ? cleanText(v) : null);

/**
 * Current members of both chambers, keyed by `pad_intern`. The Nationalrat list carries the id only in the
 * `/person/{id}` link, the Bundesrat list in its own column. Both need a gender selection in the body: the
 * server answers "Mann und/oder Frau muss ausgewählt sein" for an empty body.
 */
export async function loadCurrentMembers(client: ParlamentClient): Promise<Map<number, CurrentInfo>> {
  return client.cached('current-members', CURRENT_TTL_MS, async () => {
    const body = { M: ['M'], W: ['W'] };
    const members = new Map<number, CurrentInfo>();

    for (const o of rowsToObjects(await client.filterPost(CURRENT_NR_FBEZ, body, { all: true }))) {
      const pad = Number(/\/person\/(\d+)/.exec(String(o['link'] ?? ''))?.[1]);
      if (!Number.isInteger(pad)) continue;
      members.set(pad, {
        gremium: 'NR',
        klub: str(o['Klub']),
        wahlkreis: str(o['Wahlkreis']),
        bundesland: htmlAttr(o['Bundesland'], 'title') ?? str(o['Bundesland']),
      });
    }
    for (const o of rowsToObjects(await client.filterPost(CURRENT_BR_FBEZ, body, { all: true }))) {
      const pad = Number(o['pad_intern']);
      if (!Number.isInteger(pad)) continue;
      members.set(pad, { gremium: 'BR', klub: str(o['Fraktion']), wahlkreis: str(o['Wahlkreis']), bundesland: str(o['Bundesland']) });
    }
    return members;
  });
}

/** All persons ever, annotated with their current mandate where there is one. */
export async function loadPersons(client: ParlamentClient): Promise<Person[]> {
  const persons = await client.cached('persons', PERSONS_TTL_MS, async () => {
    const resp = await client.filterData(PERSONS_LIST_ID);
    const list: Person[] = [];
    for (const o of rowsToObjects(resp)) {
      const pad = Number(o['pad_intern']);
      const name = typeof o['Name'] === 'string' ? cleanText(o['Name']) : '';
      if (!Number.isInteger(pad) || !name) continue;
      const portrait = typeof o['portrait'] === 'string' && o['portrait'] ? o['portrait'] : null;
      const funktion = typeof o['Funktion'] === 'string' ? cleanText(o['Funktion']) : '';
      list.push({
        padIntern: pad,
        name,
        funktion: funktion || null,
        gremien: parseGremien(o['persart']),
        geschlecht: o['geschl'] === 'M' || o['geschl'] === 'W' ? o['geschl'] : null,
        url: `${BASE_URL}/person/${pad}`,
        portraitUrl: portrait ? BASE_URL + portrait : null,
        aktuell: null,
      });
    }
    return list;
  });
  // The "current" annotation is best effort: if that list fails, searching by name must still work.
  let current: Map<number, CurrentInfo> | null = null;
  try {
    current = await loadCurrentMembers(client);
  } catch (e) {
    if (!(e instanceof ParlamentError)) throw e;
    console.error(`parlament-at-mcp: current members unavailable (${e.message})`);
  }
  return persons.map((p) => ({ ...p, aktuell: current?.get(p.padIntern) ?? null }));
}

export interface PersonQuery {
  name?: string;
  gremium?: string;
  funktion?: string;
  nurAktuell?: boolean;
  klub?: string;
  bundesland?: string;
  limit: number;
  offset: number;
}

export function searchPersons(all: Person[], q: PersonQuery): { total: number; items: Person[] } {
  const name = q.name ? fold(q.name).split(/\s+/).filter(Boolean) : [];
  const funktion = q.funktion ? fold(q.funktion) : '';
  const gremium = q.gremium?.trim().toLowerCase();
  const klub = q.klub ? fold(q.klub) : '';
  const land = q.bundesland ? fold(q.bundesland) : '';
  const hits = all.filter(
    (p) =>
      name.every((part) => fold(p.name).includes(part)) &&
      (!funktion || fold(p.funktion ?? '').includes(funktion)) &&
      (!gremium || p.gremien.some((g) => g.toLowerCase() === gremium)) &&
      (!(q.nurAktuell || klub || land) || p.aktuell !== null) &&
      (!klub || fold(p.aktuell?.klub ?? '') === klub || fold(p.aktuell?.klub ?? '').includes(klub)) &&
      (!land || fold(p.aktuell?.bundesland ?? '').includes(land)),
  );
  return { total: hits.length, items: hits.slice(q.offset, q.offset + q.limit) };
}

export function describeCurrent(a: CurrentInfo): string {
  const body = a.gremium === 'NR' ? 'Nationalrat' : 'Bundesrat';
  // The Wahlkreis usually names the Bundesland already ("9 Wien"); say it twice only when it adds something.
  const land = a.bundesland && !fold(a.wahlkreis ?? '').includes(fold(a.bundesland)) ? a.bundesland : null;
  return [`AKTUELL im ${body}`, a.klub && `Klub ${a.klub}`, a.wahlkreis && `Wahlkreis ${a.wahlkreis}`, land].filter(Boolean).join(' · ');
}

export function formatPersons(result: { total: number; items: Person[] }, q: PersonQuery): string {
  if (result.total === 0) {
    return 'Keine Personen gefunden. Tipp: Namen ohne Titel suchen ("Rendi-Wagner"), Gremium als Kürzel (NR, BR, BuREG); klub/bundesland/nur_aktuell gelten nur für aktuelle Mitglieder von Nationalrat und Bundesrat.';
  }
  const lines = result.items.map((p) => {
    const body = p.gremien.length ? ` [${p.gremien.join(', ')}]` : '';
    const now = p.aktuell ? `\n  ${describeCurrent(p.aktuell)}` : '';
    return `- ${p.name} — ${p.funktion ?? 'keine Funktion angegeben'}${body}${now}\n  ${p.url} (pad_intern ${p.padIntern})`;
  });
  const from = q.offset + 1;
  const to = q.offset + result.items.length;
  const more = to < result.total ? ` Weitere Treffer mit offset=${to}.` : '';
  return `${result.total} Treffer, angezeigt ${from}–${to}.${more}\n\n${lines.join('\n')}\n\nLebenslauf und Mandate: parl_person; Reden: parl_reden_person (jeweils mit pad_intern).`;
}

export function registerAbgeordnete(server: McpServer, client: ParlamentClient): void {
  server.registerTool(
    'parl_abgeordnete',
    {
      title: 'Personen im österreichischen Parlament suchen',
      description:
        'Sucht Personen, die dem österreichischen Parlament angehört haben oder angehören (Nationalrat, Bundesrat, Bundesregierung u. a.), ' +
        'nach Name, Gremium, Funktion und - für aktuelle Mitglieder - Klub und Bundesland. ' +
        'Aktuelle Mitglieder von Nationalrat und Bundesrat sind markiert (mit Klub, Wahlkreis, Bundesland); nur_aktuell=true zeigt nur sie. ' +
        'Die Liste umfasst auch frühere Mitglieder, Regierungsmitglieder und Parlamentsbedienstete. Quelle: offene Daten des Parlaments (CC BY 4.0). ' +
        'Gremium-Kürzel: NR Nationalrat, BR Bundesrat, BuREG Bundesregierung, BV Bundesversammlung, MEP EU-Parlament, LH Landeshauptleute, ' +
        'KN/PN Konstituierende/Provisorische Nationalversammlung, MPO Mitglieder des Präsidiums/Ordnungsorgane.',
      inputSchema: {
        name: z.string().min(1).max(100).optional().describe('Name oder Namensteile, ohne Titel, Groß-/Kleinschreibung und Umlaute egal'),
        gremium: z.string().min(1).max(10).optional().describe('Gremium-Kürzel, z. B. NR, BR, BuREG'),
        funktion: z.string().min(1).max(100).optional().describe('Teil der Funktionsbezeichnung, z. B. "Bundesminister" oder "Klubobmann"'),
        nur_aktuell: z.boolean().optional().describe('Nur aktuelle Mitglieder von Nationalrat und Bundesrat'),
        klub: z.string().min(1).max(30).optional().describe('Klub/Fraktion eines aktuellen Mitglieds, z. B. SPÖ, FPÖ, NEOS, GRÜNE'),
        bundesland: z.string().min(1).max(30).optional().describe('Bundesland eines aktuellen Mitglieds, z. B. Wien oder Oberösterreich'),
        limit: z.number().int().min(1).max(100).default(20).describe('Maximale Anzahl Treffer'),
        offset: z.number().int().min(0).default(0).describe('Treffer überspringen (für Seiten)'),
      },
      outputSchema: listOutput(personItemSchema),
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (args) => {
      const query: PersonQuery = {
        limit: args.limit ?? 20,
        offset: args.offset ?? 0,
        ...(args.name ? { name: args.name } : {}),
        ...(args.gremium ? { gremium: args.gremium } : {}),
        ...(args.funktion ? { funktion: args.funktion } : {}),
        ...(args.nur_aktuell ? { nurAktuell: true } : {}),
        ...(args.klub ? { klub: args.klub } : {}),
        ...(args.bundesland ? { bundesland: args.bundesland } : {}),
      };
      try {
        const result = searchPersons(await loadPersons(client), query);
        return listResult(formatPersons(result, query), result.total, query.offset, result.items);
      } catch (e) {
        if (e instanceof ParlamentError)
          return { isError: true, content: [{ type: 'text' as const, text: `Das Parlament hat nicht geantwortet: ${e.message}` }] };
        throw e;
      }
    },
  );
}
