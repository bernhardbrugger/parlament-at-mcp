/** The Parliament pages its lists with 50 rows per page. */
export const PAGE_SIZE = 50;

export interface PageResult<T> {
  /** Total hits as reported by the server. */
  total: number;
  /** Rows of this page, already parsed. */
  rows: T[];
  /** Number of raw rows the server sent (a short page means: last page). */
  rawRows: number;
}

/**
 * Serve `offset`/`limit` from 50-row server pages. Fetches the pages that cover the range (at most two
 * for limit <= 50) and slices.
 */
export async function fetchSlice<T>(
  offset: number,
  limit: number,
  fetchPage: (page: number) => Promise<PageResult<T>>,
): Promise<{ total: number; items: T[] }> {
  const firstPage = Math.floor(offset / PAGE_SIZE) + 1;
  const lastPage = Math.floor((offset + limit - 1) / PAGE_SIZE) + 1;
  let total = 0;
  const rows: T[] = [];
  for (let page = firstPage; page <= lastPage; page++) {
    const res = await fetchPage(page);
    total = res.total;
    rows.push(...res.rows);
    if (res.rawRows < PAGE_SIZE) break; // last page
  }
  const start = offset - (firstPage - 1) * PAGE_SIZE;
  return { total, items: rows.slice(start, start + limit) };
}

/** "27.10.2026" -> "2026-10-27"; anything else -> null. */
export function isoFromDe(s: unknown): string | null {
  const m = typeof s === 'string' ? /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(s.trim()) : null;
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}
