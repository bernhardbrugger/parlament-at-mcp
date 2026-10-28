import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { BASE_URL, HttpError, ParlamentError, type ParlamentClient } from '../client.js';
import { parseLegisPeriod } from '../legis-period.js';
import { cleanText, truncate } from '../text.js';
import type { DetailResponse } from '../types.js';

/** "7436/J" or "6209/AB" -> { number: 7436, type: "J" } */
export function parseZitation(z: string): { number: number; type: string } {
  const m = /^\s*(\d{1,6})\s*\/\s*([A-Za-z]{1,6})\s*$/.exec(z);
  if (!m) throw new Error(`Ungültige Zitation: "${z}". Erwartet z. B. "7436/J" (Anfrage) oder "6209/AB" (Beantwortung).`);
  return { number: Number(m[1]), type: m[2]!.toUpperCase() };
}

/** Builds the site path from validated parts only, so no caller-controlled text reaches the URL. */
export function gegenstandPath(gp: string | number, zitation: string): string {
  const period = parseLegisPeriod(gp);
  const { number, type } = parseZitation(zitation);
  return `/gegenstand/${period}/${type}/${number}`;
}

function absolute(link: string): string {
  return link.startsWith('http') ? link : BASE_URL + (link.startsWith('/') ? '' : '/') + link;
}

/** HTML snippet -> one line of text; line breaks become " · ". */
function htmlText(html: string): string {
  return cleanText(html.replace(/<br\s*\/?>/gi, ' · ').replace(/ · (?: · )+/g, ' · '));
}

/** `<ul><li>..</li></ul>` -> list of item texts. */
function htmlItems(html: string | null | undefined): string[] {
  if (!html) return [];
  return [...html.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map((m) => cleanText(m[1] ?? '')).filter(Boolean);
}

function isoToDe(s: string | null | undefined): string | null {
  const m = s ? /^(\d{4})-(\d{2})-(\d{2})/.exec(s) : null;
  return m ? `${m[3]}.${m[2]}.${m[1]}` : null;
}

export function formatGegenstand(d: DetailResponse, path: string): string {
  const c = d.content;
  const lines: string[] = [];
  lines.push(cleanText(c.title ?? c.zitation ?? path));
  lines.push([c.type, c.zitation && `Nr. ${c.zitation}`, c.gp_code && `${c.gp_code}. GP`].filter(Boolean).join(' · '));
  const eingelangt = isoToDe(c.einlangen);
  if (eingelangt) lines.push(`Eingelangt: ${eingelangt}`);

  if (c.names?.length) {
    lines.push('', 'Beteiligte:');
    for (const n of c.names) {
      const party = n.frak_code ? ` (${n.frak_code})` : '';
      const org = n.ltext ? `, ${cleanText(n.ltext)}` : '';
      const url = n.url ? ` — ${absolute(n.url)}` : '';
      lines.push(`- ${n.funktext ?? 'Beteiligt'}: ${cleanText(n.name)}${party}${org}${url}`);
    }
  }
  if (c.description) lines.push('', truncate(cleanText(c.description), 1200));

  // Bills: where the item stands in the legislative process
  if (c.status?.description) lines.push('', `Stand: ${htmlText(c.status.description)}`);
  for (const b of c.status?.bgbllinks ?? []) if (b.title && b.title !== 'Kunsttext') lines.push(`  ${b.title}: ${b.link}`);
  if (c.vote?.text) lines.push(`Abstimmung: ${cleanText(c.vote.text)}`);
  for (const part of [c.shortinfo?.teil1, c.shortinfo?.teil2]) {
    const items = htmlItems(part);
    if (items.length) lines.push('', ...(part === c.shortinfo?.teil1 ? ['Kurzinformation:'] : []), ...items.map((i) => `- ${i}`));
  }
  if (c.phase?.length) {
    lines.push('', 'Verfahren:');
    for (const p of c.phase) {
      lines.push(`${p.name ?? 'Verfahrensschritt'}:`);
      for (const s of p.stages ?? []) lines.push(`- ${s.date ? s.date + ': ' : ''}${truncate(htmlText(s.text), 300)}`);
    }
  }

  if (c.stages?.length) {
    lines.push('', 'Verlauf:');
    for (const s of c.stages) lines.push(`- ${s.date ? s.date + ': ' : ''}${cleanText(s.text)}`);
  }
  const docs = (c.documents ?? []).flatMap((g) => (g.documents ?? []).map((x) => ({ title: g.title, ...x })));
  if (docs.length) {
    lines.push('', 'Dokumente:');
    for (const x of docs) lines.push(`- ${x.title ?? 'Dokument'}${x.type ? ` (${x.type})` : ''}: ${absolute(x.link)}`);
  }
  if (c.reference?.length) {
    lines.push('', 'Bezug:');
    for (const r of c.reference) {
      lines.push(
        `- ${[r.text, r.zitation].filter(Boolean).join(' ')}${r.subject ? ` — ${truncate(cleanText(r.subject), 120)}` : ''}${r.url ? ` ${absolute(r.url)}` : ''}`,
      );
    }
  }
  const press = (c.correspondence ?? []).filter((p) => p.title && p.url);
  if (press.length) {
    lines.push('', 'Parlamentskorrespondenz (Pressemeldungen):');
    for (const p of press.slice(0, 5)) lines.push(`- ${p.date ? p.date + ': ' : ''}${cleanText(p.title!)} — ${absolute(p.url!)}`);
    if (press.length > 5) lines.push(`- … und ${press.length - 5} weitere`);
  }
  const topics = c.topics?.data.bubbles.map((b) => b.label) ?? [];
  const words = c.headwords?.data.bubbles.map((b) => b.label) ?? [];
  if (topics.length) lines.push('', `Themen: ${topics.join(', ')}`);
  if (words.length) lines.push(`Schlagworte: ${words.join(', ')}`);
  lines.push('', `Quelle: ${BASE_URL}${path}`);
  return lines.join('\n');
}

export function registerGegenstand(server: McpServer, client: ParlamentClient): void {
  server.registerTool(
    'parl_gegenstand',
    {
      title: 'Verhandlungsgegenstand im Detail (Einbringer, Verlauf, Dokumente)',
      description:
        'Zeigt Details zu einem Gegenstand des Nationalrats: Anfragen ("7436/J"), Beantwortungen ("6209/AB"), Gesetzesvorlagen ("251/I"), Petitionen ("21/PET"), Bürgerinitiativen ("8/BI"): ' +
        'Titel, wer sie eingebracht bzw. beantwortet hat (mit Partei-Kürzel), Verlauf, PDF-Dokumente und Bezüge. ' +
        'Zitation und Gesetzgebungsperiode stehen in den Ergebnissen von parl_anfragen. Quelle: offene Daten des Parlaments (CC BY 4.0).',
      inputSchema: {
        gp: z.union([z.string().min(1).max(8), z.number().int().min(1).max(40)]).describe('Gesetzgebungsperiode: 28 oder "XXVIII"'),
        zitation: z.string().min(3).max(14).describe('Nummer und Art, z. B. "7436/J" oder "6209/AB"'),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ gp, zitation }) => {
      let path: string;
      try {
        path = gegenstandPath(gp, zitation);
      } catch (e) {
        return { isError: true, content: [{ type: 'text', text: (e as Error).message }] };
      }
      try {
        const detail = await client.detail(path);
        return { content: [{ type: 'text', text: formatGegenstand(detail, path) }] };
      } catch (e) {
        if (e instanceof HttpError && e.status === 404) {
          return {
            isError: true,
            content: [{ type: 'text', text: `Kein Gegenstand unter ${path} gefunden. Gesetzgebungsperiode und Zitation prüfen.` }],
          };
        }
        if (e instanceof ParlamentError) {
          return { isError: true, content: [{ type: 'text', text: `Das Parlament hat nicht geantwortet: ${e.message}` }] };
        }
        throw e;
      }
    },
  );
}
