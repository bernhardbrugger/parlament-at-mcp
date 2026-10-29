import { z } from 'zod';

/**
 * Shape of the machine-readable part of every list tool: `structuredContent` next to the text.
 * Clients that understand it can use the data directly; the text stays for everyone else (and for the model).
 */
export function listOutput<T extends z.ZodTypeAny>(item: T) {
  return {
    total: z.number().int().describe('Total number of hits reported by the Parliament (may be a lower bound, see the text)'),
    offset: z.number().int().describe('Index of the first returned item'),
    items: z.array(item),
  };
}

export function listResult<T>(text: string, total: number, offset: number, items: T[]) {
  return { content: [{ type: 'text' as const, text }], structuredContent: { total, offset, items } };
}

/** Input flag shared by the list tools: one line per hit instead of a block, to save context on long lists. */
export const kompaktInput = z
  .boolean()
  .default(false)
  .describe('Eine Zeile pro Treffer (Betreff gekürzt, Link bleibt) statt eines Blocks; spart Kontext bei langen Listen');

/** Last line of a compact list, so the model knows what was left out and how to get it. */
export const KOMPAKT_HINWEIS = 'Kompaktansicht: Texte gekürzt, Zusatzangaben weggelassen; alle Angaben mit kompakt=false.';

const nullableString = z.string().nullable();

export const anfrageItemSchema = z.object({
  zitation: z.string().describe('Citation, e.g. "7436/J"'),
  datum: nullableString,
  artCode: nullableString,
  art: nullableString,
  betreff: z.string(),
  status: nullableString,
  url: nullableString,
});

export const gegenstandItemSchema = z.object({
  zitation: z.string().describe('Citation for parl_gegenstand, e.g. "251/I"'),
  nummerText: nullableString,
  datum: nullableString,
  art: nullableString,
  artLang: nullableString,
  betreff: z.string(),
  abstimmung: nullableString,
  themen: z.array(z.string()),
  schlagworte: z.array(z.string()),
  url: nullableString,
});

export const sitzungItemSchema = z.object({
  gremium: z.string(),
  gp: nullableString,
  nummer: z.number().int().nullable(),
  datum: nullableString,
  titel: z.string(),
  art: nullableString,
  path: nullableString,
  url: nullableString,
});

export const personItemSchema = z.object({
  padIntern: z.number().int(),
  name: z.string(),
  funktion: nullableString,
  gremien: z.array(z.string()),
  geschlecht: z.enum(['M', 'W']).nullable(),
  url: z.string(),
  portraitUrl: nullableString,
  aktuell: z
    .object({ gremium: z.enum(['NR', 'BR']), klub: nullableString, wahlkreis: nullableString, bundesland: nullableString })
    .nullable()
    .describe('Set when the person is a current member of the Nationalrat or Bundesrat'),
});

export const redeItemSchema = z.object({
  gremium: z.enum(['NR', 'BR']),
  gp: z.string(),
  sitzung: z.number().int(),
  datum: nullableString,
  thema: z.string(),
  protokollUrl: nullableString,
});

export const ausschussItemSchema = z.object({
  name: z.string(),
  seit: nullableString,
  path: nullableString,
  url: nullableString,
});

export const sucheItemSchema = z.object({
  bereich: nullableString.describe('Kind of hit as the Parliament labels it, e.g. "Protokolle"'),
  titel: z.string(),
  datum: nullableString,
  ausschnitt: z.string().describe('Text around the match, matches in **bold**'),
  url: nullableString,
  rede: z
    .object({
      gremium: z.enum(['NR', 'BR']),
      gp: nullableString.describe('Legislative period for the Nationalrat, null for the Bundesrat'),
      sitzung: z.number().int(),
      rede: z.number().int().describe('Pass to parl_rede as rede'),
      redner: nullableString,
    })
    .nullable()
    .describe('Set when the hit is a speech: the arguments for parl_rede'),
  gegenstand: z
    .object({ gp: z.string(), zitation: z.string() })
    .nullable()
    .describe('Set when the hit is an item: the arguments for parl_gegenstand'),
});
