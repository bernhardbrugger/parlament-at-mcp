import type { z } from 'zod';
import {
  detailSchema,
  filterResponseSchema,
  parseSession,
  personSchema,
  sessionSchema,
  type DetailResponse,
  type FilterResponse,
  type PersonResponse,
  type Session,
} from './types.js';

export const BASE_URL = 'https://www.parlament.gv.at';
const ALLOWED_HOSTS = new Set(['www.parlament.gv.at']);
const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);

export class ParlamentError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ParlamentError';
  }
}

export class HttpError extends ParlamentError {
  constructor(readonly status: number) {
    super(`HTTP ${status} from the Parliament API.`);
  }
}

export interface ClientOptions {
  baseUrl?: string;
  /** Minimum pause between two requests in ms. Default 1000: the Parliament publishes no rate limit, so be polite. */
  delayMs?: number;
  timeoutMs?: number;
  /** Extra attempts after the first one for 429/5xx and network errors. */
  retries?: number;
  userAgent?: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/**
 * Small, polite HTTP client for the Austrian Parliament's open data JSON interface.
 *
 * - one request at a time, `delayMs` between requests
 * - retries with exponential backoff on 429/5xx and network errors
 * - only talks to www.parlament.gv.at (the base URL is checked, so a bad config cannot turn this into an open proxy)
 * - every response is validated with zod before anything else touches it
 */
export class ParlamentClient {
  private readonly baseUrl: string;
  private readonly delayMs: number;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly userAgent: string;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private lastRequestAt = Number.NEGATIVE_INFINITY;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly cache = new Map<string, { at: number; value: unknown }>();

  constructor(opts: ClientOptions = {}) {
    this.baseUrl = opts.baseUrl ?? BASE_URL;
    if (!ALLOWED_HOSTS.has(new URL(this.baseUrl).host)) {
      throw new ParlamentError(`Refusing to talk to ${this.baseUrl}: only www.parlament.gv.at is allowed.`);
    }
    this.delayMs = opts.delayMs ?? 1000;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.retries = opts.retries ?? 2;
    this.userAgent = opts.userAgent ?? 'parlament-at-mcp (+https://github.com/bernhardbrugger/parlament-at-mcp)';
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = opts.now ?? Date.now;
  }

  /** GET a complete list by its list id, e.g. 10400 = all persons. */
  filterData(listeId: number): Promise<FilterResponse> {
    return this.json(`/Filter/api/filter/data/${listeId}?js=eval&showAll=true`, { method: 'GET' });
  }

  /**
   * POST a filter query (e.g. `FBEZ=WFP_005` = inquiries and answers). Every body value MUST be an array
   * of strings: the server answers 500 for plain strings.
   *
   * The server pages with 50 rows per page (`pageNumber`, starting at 1; a page beyond the end returns
   * zero rows). `all: true` returns every row in one response - for 7,500 inquiries that is 6.8 MB, so
   * only use it for small, searched result sets.
   */
  filterPost(
    fbez: string,
    body: Record<string, string[]>,
    opts: { page?: number; all?: boolean } = {},
  ): Promise<FilterResponse> {
    const params = new URLSearchParams({ jsMode: 'EVAL', FBEZ: fbez });
    if (opts.all) params.set('showAll', 'true');
    else params.set('pageNumber', String(opts.page ?? 1));
    return this.json(`/Filter/api/json/post?${params}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: this.baseUrl },
      body: JSON.stringify(body),
    });
  }

  /**
   * POST a filter query to a numbered list (`/Filter/api/filter/data/{id}`): 101 = items (bills, motions, ...),
   * 701 = plenary sessions. Newer than `filterPost`; paging uses `page` + `pagesize` (max 50 observed to work).
   * Body values must be arrays here too.
   */
  filterDataPost(
    listId: number,
    body: Record<string, string[]>,
    opts: { page?: number; pagesize?: number; sortrnr?: number; ascDesc?: 'ASC' | 'DESC' } = {},
  ): Promise<FilterResponse> {
    const params = new URLSearchParams({ js: 'eval', page: String(opts.page ?? 1), pagesize: String(opts.pagesize ?? 50) });
    if (opts.sortrnr !== undefined) params.set('sortrnr', String(opts.sortrnr));
    if (opts.ascDesc) params.set('ascDesc', opts.ascDesc);
    return this.json(`/Filter/api/filter/data/${listId}?${params}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: this.baseUrl },
      body: JSON.stringify(body),
    });
  }

  /** The raw JSON of a session page (see `parseSession`); cached for 10 minutes. */
  session(path: string): Promise<Session> {
    if (!/^\/gegenstand\/(?:[IVXL]{1,8}|BR)\/(?:NRSITZ|BRSITZ)\/\d{1,4}$/.test(path)) {
      throw new ParlamentError(`Not a valid session path: ${path}`);
    }
    return this.cached(`session:${path}`, 10 * 60 * 1000, async () => {
      const raw = await this.parse(`${path}?json=TRUE`, { method: 'GET' }, sessionSchema);
      return parseSession(raw);
    });
  }

  /** A protocol segment (HTML) below `/dokument/`. Only plain document paths are accepted. */
  async document(path: string): Promise<string> {
    if (!/^\/dokument\/(?:[IVXL]{1,8}|BR)\/(?:NRSITZ|BRSITZ)\/\d{1,4}\/[A-Za-z0-9_.-]+\.html$/.test(path)) {
      throw new ParlamentError(`Not a valid protocol document path: ${path}`);
    }
    return this.request(path, { method: 'GET', headers: { Accept: 'text/html' } });
  }

  /** The JSON twin of a person page. */
  person(padIntern: number): Promise<PersonResponse> {
    if (!Number.isInteger(padIntern) || padIntern < 1) throw new ParlamentError(`Not a valid person id: ${padIntern}`);
    return this.parse(`/person/${padIntern}?json=TRUE`, { method: 'GET' }, personSchema);
  }

  /**
   * The JSON twin of a detail page: append `?json=TRUE` to the page path. `path` must be a site path
   * such as `/gegenstand/XXVIII/J/7436`; callers validate its shape.
   */
  detail(path: string): Promise<DetailResponse> {
    if (!/^\/[A-Za-z0-9/_-]+$/.test(path) || path.includes('//')) {
      throw new ParlamentError(`Not a valid detail path: ${path}`);
    }
    return this.parse(`${path}?json=TRUE`, { method: 'GET' }, detailSchema);
  }

  /** Run `load` once per key and reuse the result for `ttlMs` (the big list endpoints change at most daily). */
  async cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
    const hit = this.cache.get(key);
    if (hit && this.now() - hit.at < ttlMs) return hit.value as T;
    const value = await load();
    this.cache.set(key, { at: this.now(), value });
    return value;
  }

  private json(path: string, init: RequestInit): Promise<FilterResponse> {
    return this.parse(path, init, filterResponseSchema);
  }

  private async parse<S extends z.ZodTypeAny>(path: string, init: RequestInit, schema: S): Promise<z.infer<S>> {
    const text = await this.request(path, init);
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (cause) {
      throw new ParlamentError('The Parliament returned something that is not JSON.', { cause });
    }
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new ParlamentError(
        `Unexpected response shape from the Parliament API: ${issue?.path.join('.') || 'root'}: ${issue?.message ?? 'invalid'}`,
      );
    }
    return parsed.data;
  }

  /** Serialise requests so the pause between them holds even when tools are called in parallel. */
  private request(path: string, init: RequestInit): Promise<string> {
    const run = this.queue.then(() => this.requestWithRetry(path, init));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async requestWithRetry(path: string, init: RequestInit): Promise<string> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      const wait = this.lastRequestAt + this.delayMs - this.now();
      if (wait > 0) await this.sleep(wait);
      try {
        const res = await this.fetchImpl(this.baseUrl + path, {
          ...init,
          headers: { 'User-Agent': this.userAgent, Accept: 'application/json', ...(init.headers as Record<string, string> | undefined) },
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        this.lastRequestAt = this.now();
        if (res.ok) return await res.text();
        lastError = new HttpError(res.status);
        if (!RETRY_STATUS.has(res.status)) throw lastError;
      } catch (e) {
        this.lastRequestAt = this.now();
        if (e instanceof HttpError && !RETRY_STATUS.has(e.status)) throw e; // 4xx etc.: retrying will not help
        lastError = e;
      }
      if (attempt < this.retries) await this.sleep(Math.min(30_000, 2 ** (attempt + 1) * 1000));
    }
    throw new ParlamentError('The Parliament API did not answer successfully (gave up after retries).', { cause: lastError });
  }
}
