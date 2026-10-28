import { z } from 'zod';

/** One column of a list returned by the Parliament's filter API. */
export const headerSchema = z
  .object({
    rnr: z.number(),
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
 * Turn positional rows into objects keyed by the column label. A column's position is `rnr - 1`.
 * Labels are not guaranteed to be unique, so a repeated label gets a `_2`, `_3`, ... suffix.
 */
export function rowsToObjects(resp: FilterResponse): Record<string, unknown>[] {
  const labels: string[] = [];
  const used = new Map<string, number>();
  for (const h of [...resp.header].sort((a, b) => a.rnr - b.rnr)) {
    const n = (used.get(h.label) ?? 0) + 1;
    used.set(h.label, n);
    labels[h.rnr - 1] = n === 1 ? h.label : `${h.label}_${n}`;
  }
  return resp.rows.map((row) => {
    const obj: Record<string, unknown> = {};
    row.forEach((value, i) => {
      const label = labels[i];
      if (label !== undefined) obj[label] = value;
    });
    return obj;
  });
}
