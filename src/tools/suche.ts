import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { BASE_URL, HttpError, ParlamentError, type ParlamentClient } from '../client.js';
import { parseLegisPeriod } from '../legis-period.js';
import { PAGE_SIZE } from '../paging.js';
import { listOutput, listResult, sucheItemSchema } from '../output.js';
import { cleanText, fold, truncate } from '../text.js';
import type { SearchBody, SearchRow } from '../types.js';

/** What to search. `category` is the Parliament's own name for the kind of document. */
export const BEREICHE = {
  reden: { category: 'Protokolle', label: 'Reden im Plenarprotokoll' },
  pressemeldungen: { category: 'Parlamentskorrespondenz', label: 'Pressemeldungen (Parlamentskorrespondenz)' },
  gegenstaende: { category: 'Verhandlungsgegenstände', label: 'Verhandlungsgegenstände (Anträge, Anfragen, Gesetze)' },
  alles: { category: null, label: 'alle Bereiche des Parlaments' },
} as const;
export type Bereich = keyof typeof BEREICHE;
export type Modus = 'alle' | 'beliebig' | 'phrase';
export type Sortierung = 'relevanz' | 'neueste' | 'aelteste';

const SEARCH_TYPE: Record<Modus, string> = { alle: 'all', beliebig: 'any', phrase: 'phrase' };
const MODUS_TEXT: Record<Modus, string> = { alle: 'alle Wörter', beliebig: 'eines der Wörter', phrase: 'genaue Wortfolge' };
const SORT = { relevanz: undefined, neueste: 'datedesc', aelteste: 'dateasc' } as const;
/** With a speaker filter the server cannot help (it does not tag speeches with persons), so this many pages are scanned. */
const MAX_SCAN_PAGES = 6;
/** The earliest and latest day the date filter is given when only one bound is asked for (both are required by the server). */
const DATE_MIN = '1920-01-01';
const DATE_MAX = '2099-12-31';

export interface SucheQuery {
  suche: string;
  modus: Modus;
  bereich: Bereich;
  nurTitel: boolean;
  gremium?: 'NR' | 'BR';
  gp?: string;
  von?: string;
  bis?: string;
  redner?: string;
  sortierung: Sortierung;
  limit: number;
  offset: number;
}

export interface RedeRef {
  gremium: 'NR' | 'BR';
  gp: string | null;
  sitzung: number;
  rede: number;
  redner: string | null;
}

export interface SucheItem {
  bereich: string | null;
  titel: string;
  datum: string | null;
  ausschnitt: string;
  url: string | null;
  rede: RedeRef | null;
  gegenstand: { gp: string; zitation: string } | null;
}

/** "2025-06-15T22:00:00.000Z" is midnight of 16 June in Vienna: show the Austrian calendar day. */
export function viennaDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Vienna', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** `YYYY-MM-DD` that is a real calendar day. */
export function isCalendarDay(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

const SPEECH_PATH = /^\/dokument\/(?:([IVXL]{1,8})|BR)\/(NRSITZ|BRSITZ)\/(\d{1,4})\/A_-_\d{2}_\d{2}_\d{2}_(\d+)\.html$/;
const ITEM_PATH = /^\/gegenstand\/([IVXL]{1,8})\/([A-Za-z]{1,6})\/(\d{1,6})$/;
/** Plain-text markers that survive `cleanText` (which strips tags) and do not occur in protocol text. */
const HIGHLIGHT_OPEN = '@@HL@@';
const HIGHLIGHT_CLOSE = '@@/HL@@';

/** Snippet with the Parliament's `<span class="highlight">` turned into **bold** (neighbouring matches become one) and all other markup removed. */
export function cleanSnippet(html: string | null | undefined): string {
  if (!html) return '';
  const marked = html
    .replace(/<span class="highlight">\s*<\/span>/g, '')
    .replace(/<span class="highlight">/g, HIGHLIGHT_OPEN)
    .replace(/<\/span>/g, HIGHLIGHT_CLOSE);
  return cleanText(marked)
    .split(`${HIGHLIGHT_CLOSE} ${HIGHLIGHT_OPEN}`)
    .join(' ')
    .split(HIGHLIGHT_OPEN)
    .join('**')
    .split(HIGHLIGHT_CLOSE)
    .join('**');
}

/** The speaker named at the end of a protocol title ("… des Nationalrates: Herbert Kickl (FPÖ)"). */
export function speakerFromTitle(title: string): string | null {
  const at = title.lastIndexOf(': ');
  const name = at >= 0 ? cleanText(title.slice(at + 2)) : '';
  return name || null;
}

export function parseHit(row: SearchRow): SucheItem | null {
  const titel = row.title ? cleanText(row.title) : '';
  if (!titel) return null;
  const link = typeof row.link === 'string' && row.link.startsWith('/') && !row.link.startsWith('//') ? row.link : null;

  let rede: RedeRef | null = null;
  const speech = link ? SPEECH_PATH.exec(link) : null;
  if (speech && row.item_type === 'stteil') {
    rede = {
      gremium: speech[2] === 'BRSITZ' ? 'BR' : 'NR',
      gp: speech[1] ?? null,
      sitzung: Number(speech[3]),
      rede: Number(speech[4]),
      redner: speakerFromTitle(titel),
    };
  }
  const item = link ? ITEM_PATH.exec(link) : null;
  return {
    bereich: row.label ? cleanText(row.label) : null,
    titel,
    datum: viennaDate(row.datetime),
    ausschnitt: truncate(cleanSnippet(row.description), 600),
    url: link ? BASE_URL + link : null,
    rede,
    gegenstand: item ? { gp: item[1]!, zitation: `${Number(item[3])}/${item[2]!.toUpperCase()}` } : null,
  };
}

/** Exactly what the website sends: the query is a plain string, every filter an array. */
export function buildSearchBody(q: SucheQuery): SearchBody {
  const body: SearchBody = {
    searchType: [SEARCH_TYPE[q.modus]],
    searchScope: [q.nurTitel ? 'title' : 'all'],
    's.sm.query': q.suche,
  };
  const category = BEREICHE[q.bereich].category;
  if (category) body['category'] = [category];
  if (q.gremium) body['gremium'] = [q.gremium === 'NR' ? 'Nationalrat' : 'Bundesrat'];
  if (q.gp && q.gremium !== 'BR') body['gp_liste'] = [q.gp];
  if (q.von || q.bis) body['date_range'] = [`${q.von ?? DATE_MIN}T00:00:00.000Z`, `${q.bis ?? DATE_MAX}T23:59:00.000Z`];
  return body;
}

/** The HTTP status behind an error: the client wraps it once it has given up retrying. */
function httpStatus(e: unknown): number | undefined {
  if (e instanceof HttpError) return e.status;
  return e instanceof ParlamentError && e.cause instanceof HttpError ? e.cause.status : undefined;
}

export interface SucheResult {
  /** Number of hits that match (with a speaker filter: found among the scanned ones). */
  total: number;
  items: SucheItem[];
  /** Hits the Parliament reports for the search itself, before the speaker filter. */
  serverTotal: number;
  /** With a speaker filter: how many hits were looked at. */
  scanned: number | null;
  /** With a speaker filter: false when more hits exist than were looked at. */
  complete: boolean;
  /** The page asked for lies behind the last one. */
  pastEnd: boolean;
}

export async function suche(client: ParlamentClient, q: SucheQuery): Promise<SucheResult> {
  const body = buildSearchBody(q);
  const sort = SORT[q.sortierung];
  const fetchPage = (page: number) => client.search(body, { page, pagesize: PAGE_SIZE, ...(sort ? { sort } : {}) });

  if (q.redner) {
    const wanted = fold(q.redner);
    const matches: SucheItem[] = [];
    let serverTotal = 0;
    let scanned = 0;
    for (let page = 1; page <= MAX_SCAN_PAGES; page++) {
      const res = await fetchPage(page);
      serverTotal = res.count;
      scanned += res.rows.length;
      for (const row of res.rows) {
        const hit = parseHit(row);
        if (hit && fold(hit.rede?.redner ?? hit.titel).includes(wanted)) matches.push(hit);
      }
      if (res.rows.length < PAGE_SIZE || matches.length >= q.offset + q.limit) break;
    }
    return {
      total: matches.length,
      items: matches.slice(q.offset, q.offset + q.limit),
      serverTotal,
      scanned,
      complete: scanned >= serverTotal,
      pastEnd: false,
    };
  }

  const first = Math.floor(q.offset / PAGE_SIZE) + 1;
  const last = Math.floor((q.offset + q.limit - 1) / PAGE_SIZE) + 1;
  const hits: SucheItem[] = [];
  let serverTotal = 0;
  let pastEnd = false;
  for (let page = first; page <= last; page++) {
    let res;
    try {
      res = await fetchPage(page);
    } catch (e) {
      // a page behind the last one is answered with HTTP 500
      if (page > 1 && httpStatus(e) === 500) {
        pastEnd = true;
        break;
      }
      throw e;
    }
    serverTotal = res.count;
    for (const row of res.rows) {
      const hit = parseHit(row);
      if (hit) hits.push(hit);
    }
    if (res.rows.length < PAGE_SIZE) break;
  }
  const start = q.offset - (first - 1) * PAGE_SIZE;
  return { total: serverTotal, items: hits.slice(start, start + q.limit), serverTotal, scanned: null, complete: true, pastEnd };
}

function where(q: SucheQuery): string {
  const parts: string[] = [BEREICHE[q.bereich].label];
  if (q.gremium) parts.push(q.gremium === 'NR' ? 'Nationalrat' : 'Bundesrat');
  if (q.gp && q.gremium !== 'BR') parts.push(`${q.gp}. GP`);
  if (q.von || q.bis) parts.push(`${q.von ?? 'Beginn'} bis ${q.bis ?? 'heute'}`);
  if (q.nurTitel) parts.push('nur Titel');
  return parts.join(', ');
}

export function formatSuche(result: SucheResult, q: SucheQuery): string {
  const head = `Suche "${q.suche}" (${MODUS_TEXT[q.modus]}; ${where(q)})`;
  if (result.pastEnd) return `${head}: keine Treffer ab offset=${q.offset}; die Suche hat weniger Treffer.`;
  if (result.serverTotal === 0) {
    return `${head}: keine Treffer. Tipp: weniger oder allgemeinere Wörter, modus="beliebig", oder den Zeitraum und die Gesetzgebungsperiode weglassen.`;
  }
  if (q.redner && result.total === 0) {
    return `${head}: ${result.serverTotal} Treffer, aber keiner von "${q.redner}" unter den ${result.scanned} geprüften. Redner-Schreibweise prüfen oder die Suche enger fassen (modus="phrase", gp, von/bis).`;
  }
  const to = q.offset + result.items.length;
  const lines: string[] = [];
  if (q.redner) {
    lines.push(
      `${head}: ${result.total} Treffer von "${q.redner}" unter den ${result.scanned} geprüften (die Suche selbst hat ${result.serverTotal}).` +
        (result.complete ? '' : ' Weitere Treffer wurden nicht geprüft: Suche enger fassen (modus="phrase", gp, von/bis).'),
    );
  } else {
    lines.push(
      `${head}: ${result.total.toLocaleString('de-AT')} Treffer, angezeigt ${q.offset + 1}–${to}.${to < result.total ? ` Weitere mit offset=${to}.` : ''}`,
    );
  }
  if (result.items.length === 0) {
    lines.push('', `Keine Treffer ab offset=${q.offset}.`);
    return lines.join('\n');
  }
  lines.push('');
  for (const it of result.items) {
    const head2 = [it.datum, it.rede?.redner ?? it.bereich].filter(Boolean).join(' · ');
    lines.push(`- ${head2}`, `  ${truncate(it.titel, 200)}`);
    if (it.ausschnitt) lines.push(`  ${it.ausschnitt}`);
    if (it.rede) {
      const r = it.rede;
      lines.push(`  Wortlaut: parl_rede gremium=${r.gremium}${r.gp ? ` gp=${r.gp}` : ''} nummer=${r.sitzung} rede=${r.rede}`);
    } else if (it.gegenstand) {
      lines.push(`  Details: parl_gegenstand gp=${it.gegenstand.gp} zitation="${it.gegenstand.zitation}"`);
    }
    if (it.url) lines.push(`  ${it.url}`);
  }
  lines.push(
    '',
    'Die Ausschnitte sind gekürzt und stehen ohne Zusammenhang: vor dem Zitieren den Wortlaut mit parl_rede lesen, Sitzung, Redner und Quelle angeben. Die Suche liefert höchstens 10.000 Treffer.',
  );
  return lines.join('\n');
}

export function registerSuche(server: McpServer, client: ParlamentClient): void {
  server.registerTool(
    'parl_suche',
    {
      title: 'Volltextsuche in Reden, Pressemeldungen und Gegenständen',
      description:
        'Durchsucht den Volltext des Parlaments: standardmäßig alle Reden in den Plenarprotokollen (Nationalrat und Bundesrat, mit Zwischenrufen), ' +
        'auf Wunsch Pressemeldungen der Parlamentskorrespondenz, Verhandlungsgegenstände (Anträge, Anfragen, Gesetze) oder alles. ' +
        'Damit lässt sich prüfen, WER ZU WELCHEM THEMA WAS gesagt hat: modus="phrase" findet eine genaue Wortfolge (Zitate prüfen), ' +
        'redner="Kickl" begrenzt auf einen Redner, von/bis und gp auf einen Zeitraum. Jeder Treffer nennt Redner, Sitzung, Datum, einen Ausschnitt und ' +
        'die Argumente für parl_rede (kompletter Wortlaut) bzw. parl_gegenstand. Ein Treffer belegt nur, dass etwas gesagt wurde, nicht ob es stimmt. ' +
        'Quelle: offene Daten des Parlaments (CC BY 4.0).',
      inputSchema: {
        suche: z
          .string()
          .min(2)
          .max(200)
          .describe('Suchbegriffe oder eine Wortfolge, z. B. "Staatsbesuch" oder "Ich rede vom Staatsbesuch"'),
        modus: z
          .enum(['alle', 'beliebig', 'phrase'])
          .default('alle')
          .describe('alle = alle Wörter kommen vor, beliebig = mindestens eines, phrase = genau diese Wortfolge'),
        bereich: z
          .enum(['reden', 'pressemeldungen', 'gegenstaende', 'alles'])
          .default('reden')
          .describe('reden = Plenarprotokolle, pressemeldungen = Parlamentskorrespondenz, gegenstaende = Anträge/Anfragen/Gesetze, alles'),
        nur_titel: z.boolean().default(false).describe('Nur in Titeln suchen (bei Reden steht der Redner im Titel)'),
        gremium: z.enum(['NR', 'BR']).optional().describe('NR = Nationalrat, BR = Bundesrat'),
        gp: z
          .union([z.string().min(1).max(8), z.number().int().min(1).max(40)])
          .optional()
          .describe('Gesetzgebungsperiode: 28 oder "XXVIII" (gilt nicht für den Bundesrat)'),
        von: z.string().optional().describe('Ab diesem Tag, Format JJJJ-MM-TT'),
        bis: z.string().optional().describe('Bis zu diesem Tag (einschließlich), Format JJJJ-MM-TT'),
        redner: z
          .string()
          .min(2)
          .max(60)
          .optional()
          .describe(
            'Nur Reden dieser Person (Name oder Teil davon, z. B. "Kickl"); prüft die ersten 300 Treffer der Suche, deshalb Suche eng fassen',
          ),
        sortierung: z.enum(['relevanz', 'neueste', 'aelteste']).default('relevanz').describe('Reihenfolge der Treffer'),
        limit: z.number().int().min(1).max(50).default(10).describe('Anzahl Treffer pro Aufruf'),
        offset: z.number().int().min(0).max(9950).default(0).describe('Treffer überspringen (Seiten)'),
      },
      outputSchema: listOutput(sucheItemSchema),
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (args) => {
      const fail = (text: string) => ({ isError: true as const, content: [{ type: 'text' as const, text }] });
      for (const [name, value] of [
        ['von', args.von],
        ['bis', args.bis],
      ] as const) {
        if (value !== undefined && !isCalendarDay(value))
          return fail(`Ungültiges Datum für ${name}: "${value}". Erwartet JJJJ-MM-TT, z. B. 2025-06-16.`);
      }
      if (args.von && args.bis && args.von > args.bis) return fail(`"von" (${args.von}) liegt nach "bis" (${args.bis}).`);
      let gp: string | undefined;
      try {
        gp = args.gp === undefined ? undefined : parseLegisPeriod(args.gp);
      } catch (e) {
        return fail((e as Error).message);
      }
      const query: SucheQuery = {
        suche: args.suche.trim(),
        modus: args.modus,
        bereich: args.bereich,
        nurTitel: args.nur_titel,
        sortierung: args.sortierung,
        limit: args.limit,
        offset: args.offset,
        ...(args.gremium ? { gremium: args.gremium } : {}),
        ...(gp ? { gp } : {}),
        ...(args.von ? { von: args.von } : {}),
        ...(args.bis ? { bis: args.bis } : {}),
        ...(args.redner ? { redner: args.redner.trim() } : {}),
      };
      try {
        const result = await suche(client, query);
        return listResult(formatSuche(result, query), result.total, query.offset, result.items);
      } catch (e) {
        if (e instanceof ParlamentError) return fail(`Das Parlament hat nicht geantwortet: ${e.message}`);
        throw e;
      }
    },
  );
}
