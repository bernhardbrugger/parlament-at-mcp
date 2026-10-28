import { z } from 'zod';

/**
 * One column of a list returned by the Parliament's filter API. Link columns have no `rnr`
 * (observed on the inquiries list), so a column's position falls back to its index in the header array.
 */
export const headerSchema = z
  .object({
    rnr: z.number().optional(),
    label: z.string(),
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
 * Turn positional rows into objects keyed by the column label. A column's position is `rnr - 1`,
 * or its index in the header when `rnr` is missing. Labels are not unique (two `link` columns), so
 * a repeated label gets a `_2`, `_3`, ... suffix.
 */
export function rowsToObjects(resp: FilterResponse): Record<string, unknown>[] {
  const labels: string[] = [];
  const used = new Map<string, number>();
  resp.header.forEach((h, index) => {
    const n = (used.get(h.label) ?? 0) + 1;
    used.set(h.label, n);
    labels[h.rnr !== undefined ? h.rnr - 1 : index] = n === 1 ? h.label : `${h.label}_${n}`;
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

const bubbles = z
  .object({ data: z.object({ bubbles: z.array(z.object({ label: z.string() }).passthrough()) }).passthrough() })
  .passthrough();

/**
 * The JSON twin of an item detail page (`/gegenstand/{GP}/{type}/{number}?json=TRUE`).
 * Only what the tools use is typed; everything else passes through.
 */
export const detailSchema = z
  .object({
    content: z
      .object({
        type: z.string().optional(),
        title: z.string().optional(),
        zitation: z.string().optional(),
        description: z.string().optional(),
        gp_code: z.string().optional(),
        ityp: z.string().optional(),
        inr: z.number().optional(),
        einlangen: z.string().optional(),
        update: z.string().optional(),
        stages: z.array(z.object({ date: z.string().optional(), text: z.string() }).passthrough()).optional(),
        documents: z
          .array(
            z
              .object({
                title: z.string().optional(),
                documents: z.array(z.object({ link: z.string(), type: z.string().optional() }).passthrough()).optional(),
              })
              .passthrough(),
          )
          .optional(),
        names: z
          .array(
            z
              .object({
                funktext: z.string().optional(),
                name: z.string(),
                frak_code: z.string().optional(),
                ltext: z.string().optional(),
                url: z.string().optional(),
              })
              .passthrough(),
          )
          .optional(),
        reference: z
          .array(z.object({ text: z.string().optional(), subject: z.string().optional(), zitation: z.string().optional(), url: z.string().optional() }).passthrough())
          .optional(),
        topics: bubbles.optional(),
        headwords: bubbles.optional(),
      })
      .passthrough(),
  })
  .passthrough();

export type DetailResponse = z.infer<typeof detailSchema>;
