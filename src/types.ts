import { z } from 'zod';

/**
 * One column of a list returned by the Parliament's filter API. Link columns have no `rnr`
 * (observed on the inquiries list), so a column's position falls back to its index in the header array.
 */
export const headerSchema = z
  .object({
    rnr: z.number().optional(),
    /** Several lists have unlabeled (mostly hidden) columns; they are exposed as `col{index}`. */
    label: z.string().optional(),
    hidden: z.boolean().optional(),
    mediaType: z.string().optional(),
  })
  .passthrough();

/**
 * The envelope every list endpoint (`/Filter/api/filter/data/{id}`, `/Filter/api/json/post`) returns:
 * column definitions plus positional rows. `pages`/`count` describe the whole result set.
 */
export const filterResponseSchema = z
  .object({
    pages: z.number(),
    count: z.number(),
    lastSync: z.string().optional(),
    header: z.array(headerSchema),
    rows: z.array(z.array(z.unknown())),
  })
  .passthrough();

export type FilterResponse = z.infer<typeof filterResponseSchema>;

/**
 * Turn positional rows into objects keyed by the column label.
 *
 * A column's position is its index in the header array when the header has as many entries as the rows have
 * cells (true for every list seen so far). `rnr` is NOT reliable for that: the list of current Nationalrat
 * members numbers its columns 1, 2, 4, 5, ... (3 is missing), so `rnr - 1` shifts every later column by one.
 * Only if header and rows disagree in length does `rnr - 1` serve as the fallback.
 * Columns without a label are exposed as `col{position}`; repeated labels get a `_2`, `_3` suffix.
 */
export function rowsToObjects(resp: FilterResponse): Record<string, unknown>[] {
  const byIndex = (resp.rows[0]?.length ?? resp.header.length) === resp.header.length;
  const labels: string[] = [];
  const used = new Map<string, number>();
  resp.header.forEach((h, index) => {
    const position = byIndex ? index : h.rnr !== undefined ? h.rnr - 1 : index;
    const label = h.label ?? `col${position}`;
    const n = (used.get(label) ?? 0) + 1;
    used.set(label, n);
    labels[position] = n === 1 ? label : `${label}_${n}`;
  });
  return resp.rows.map((row) => {
    const obj: Record<string, unknown> = {};
    row.forEach((value, i) => {
      const label = labels[i];
      if (label !== undefined) obj[label] = value;
    });
    return obj;
  });
}

/**
 * Optional structured blocks of a page. If the API changes the shape of one of them it degrades to `undefined`
 * (the tool then simply omits that section) instead of failing the whole page.
 */
const lenient = <T extends z.ZodTypeAny>(schema: T) => schema.nullish().catch(undefined);

const linkDoc = z.object({ link: z.string(), type: z.string().nullish() }).passthrough();
const stage = z.object({ date: z.string().nullish(), text: z.string() }).passthrough();

const bubbles = z
  .object({ data: z.object({ bubbles: z.array(z.object({ label: z.string() }).passthrough()) }).passthrough() })
  .passthrough();

/**
 * The JSON twin of an item detail page (`/gegenstand/{GP}/{type}/{number}?json=TRUE`, `/ausschuss/...`).
 * Only what the tools use is typed; everything else passes through. Scalar fields are `nullish()` because the API sends
 * `null` for many of them (e.g. `frak_code` of ministers).
 */
export const detailSchema = z
  .object({
    content: z
      .object({
        type: z.string().nullish(),
        title: z.string().nullish(),
        zitation: z.string().nullish(),
        description: z.string().nullish(),
        gp_code: z.string().nullish(),
        ityp: z.string().nullish(),
        inr: z.number().nullish(),
        einlangen: z.string().nullish(),
        update: z.string().nullish(),
        aus_code: z.string().nullish(),
        aus_von: z.string().nullish(),
        stages: lenient(z.array(stage)),
        documents: lenient(z.array(z.object({ title: z.string().nullish(), documents: z.array(linkDoc).nullish() }).passthrough())),
        names: lenient(
          z.array(
            z
              .object({
                funktext: z.string().nullish(),
                name: z.string(),
                frak_code: z.string().nullish(),
                ltext: z.string().nullish(),
                url: z.string().nullish(),
              })
              .passthrough(),
          ),
        ),
        reference: lenient(
          z.array(
            z
              .object({
                text: z.string().nullish(),
                subject: z.string().nullish(),
                zitation: z.string().nullish(),
                url: z.string().nullish(),
              })
              .passthrough(),
          ),
        ),
        topics: lenient(bubbles),
        headwords: lenient(bubbles),
        /** Committees: the latest agendas and the items assigned to the committee. */
        recentagenda: lenient(z.array(z.object({ title: z.string().nullish(), documents: z.array(linkDoc).nullish() }).passthrough())),
        assignments: lenient(
          z
            .object({
              data: z
                .object({ links: z.array(z.object({ title: z.string().nullish(), link: z.string().nullish() }).passthrough()).nullish() })
                .passthrough()
                .nullish(),
            })
            .passthrough(),
        ),
        /** Bills ("Regierungsvorlage" etc.): where the item stands, per phase of the legislative process. */
        status: lenient(
          z
            .object({
              number: z.number().nullish(),
              description: z.string().nullish(),
              bgbllinks: z.array(z.object({ title: z.string().nullish(), link: z.string() }).passthrough()).nullish(),
            })
            .passthrough(),
        ),
        phase: lenient(z.array(z.object({ name: z.string().nullish(), stages: z.array(stage).nullish() }).passthrough())),
        shortinfo: lenient(
          z.object({ teil1: z.string().nullish(), teil2: z.string().nullish(), stand: z.string().nullish() }).passthrough(),
        ),
        vote: lenient(z.object({ text: z.string().nullish(), infavor: z.boolean().nullish() }).passthrough()),
      })
      .passthrough(),
  })
  .passthrough();

export type DetailResponse = z.infer<typeof detailSchema>;

const speechLinkSchema = z
  .object({
    data: z
      .object({
        links: z.array(
          z
            .object({ documents: z.array(z.object({ link: z.string(), type: z.string().optional() }).passthrough()).optional() })
            .passthrough(),
        ),
      })
      .passthrough(),
  })
  .passthrough();

export const speechSchema = z
  .object({
    texta: z.string(),
    time: z.string().optional(),
    ts: z.string().optional(),
    st_objekte_id: z.number(),
    protocol: speechLinkSchema.optional(),
    autorisiert: z.boolean().optional(),
    veroeffentlicht: z.string().optional(),
  })
  .passthrough();

export const progressEntrySchema = z
  .object({
    text: z.string(),
    time: z.string().optional(),
    st_objekte_id: z.number().optional(),
    protocol: speechLinkSchema.optional(),
    speeches: z.array(speechSchema).optional(),
  })
  .passthrough();

/**
 * Session pages (`/gegenstand/{GP}/NRSITZ/{n}?json=TRUE`) differ from other detail pages: `content` is an
 * ARRAY of blocks - metadata, `info`, and `progress` (agenda items with their speeches). Blocks are found by
 * the keys they carry, not by position.
 */
export const sessionSchema = z.object({ content: z.array(z.record(z.unknown())) }).passthrough();

export interface Session {
  title: string;
  zitation: string | null;
  gp: string | null;
  start: string | null;
  end: string | null;
  state: string | null;
  protocolNote: string | null;
  protocols: Array<{ title: string; links: Array<{ link: string; type: string | undefined }> }>;
  progress: Array<z.infer<typeof progressEntrySchema>>;
}

export function parseSession(raw: unknown): Session {
  const blocks = sessionSchema.parse(raw).content;
  const meta = blocks.find((b) => 'zitation' in b || 'stdocuments' in b) ?? {};
  const info = (blocks.find((b) => 'info' in b)?.['info'] ?? {}) as Record<string, unknown>;
  const progressBlock = blocks.find((b) => Array.isArray(b['progress']));
  const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
  const protocols = z
    .array(
      z
        .object({
          title: z.string().optional(),
          documents: z.array(z.object({ link: z.string(), type: z.string().optional() }).passthrough()).optional(),
        })
        .passthrough(),
    )
    .catch([])
    .parse(meta['stdocuments']);
  return {
    title: str(info['title']) ?? str(meta['title']) ?? 'Sitzung',
    zitation: str(meta['zitation']),
    gp: str(meta['gp_code']),
    start: str(info['starttime']),
    end: str(info['endtime']),
    state: str(info['state']),
    protocolNote: str(meta['sthint']),
    protocols: protocols.map((p) => ({
      title: p.title ?? 'Dokument',
      links: (p.documents ?? []).map((d) => ({ link: d.link, type: d.type })),
    })),
    progress: z
      .array(progressEntrySchema)
      .catch([])
      .parse(progressBlock?.['progress'] ?? []),
  };
}

/** The JSON twin of a person page (`/person/{pad_intern}?json=TRUE`). Only what parl_person shows is typed. */
export const personSchema = z
  .object({
    content: z
      .object({
        headingbox: z.object({ title_plain: z.string().nullish(), title: z.string().nullish() }).passthrough().nullish(),
        personInfo: z
          .object({ aktiv: z.boolean().nullish(), personTyp: z.string().nullish(), pad_intern: z.number().nullish() })
          .passthrough()
          .nullish(),
        biografie: z
          .object({
            biografieStand: z.string().nullish(),
            mandatefunktionen: z
              .object({
                mandate: z
                  .array(
                    z
                      .object({
                        bez: z.string().nullish(),
                        klub: z.string().nullish(),
                        wahlpartei: z.string().nullish(),
                        wahlkreis: z.string().nullish(),
                        gremium: z.string().nullish(),
                        zeitraum: z.string().nullish(),
                        aktiv: z.boolean().nullish(),
                      })
                      .passthrough(),
                  )
                  .nullish(),
              })
              .passthrough()
              .nullish(),
            kurzbiografie: z
              .object({
                gebtext: z.string().nullish(),
                beruflicherWerdegang: z.array(z.string()).nullish(),
                bildungsweg: z.array(z.string()).nullish(),
                politischeFunktionen: z.array(z.string()).nullish(),
              })
              .passthrough()
              .nullish(),
          })
          .passthrough()
          .nullish(),
      })
      .passthrough(),
  })
  .passthrough();

export type PersonResponse = z.infer<typeof personSchema>;
