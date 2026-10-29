import { describe, expect, it } from 'vitest';
import { parseLegisPeriod, toRoman } from '../src/legis-period.js';
import { fetchSlice, isoFromDe, PAGE_SIZE } from '../src/paging.js';
import { windowText } from '../src/speech.js';
import { cleanText, fold, htmlAttr, truncate } from '../src/text.js';
import { formatGegenstaende, parseGegenstaende, type GegenstaendeQuery } from '../src/tools/gegenstaende.js';
import { formatSitzungen, parseSitzungen } from '../src/tools/sitzungen.js';
import type { FilterResponse } from '../src/types.js';

/** Small deterministic generator, so a failing case can be reproduced. */
function rng(seed: number) {
  let s = seed >>> 0;
  return (max: number) => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s % max;
  };
}

function response(header: string[], rows: unknown[][], count = rows.length): FilterResponse {
  return { pages: 1, count, header: header.map((label, i) => ({ rnr: i + 1, label })), rows } as unknown as FilterResponse;
}

describe('legislative period', () => {
  it('round-trips every period from 1 to 40 in all accepted spellings', () => {
    for (let n = 1; n <= 40; n++) {
      const roman = toRoman(n);
      expect(parseLegisPeriod(n)).toBe(roman);
      expect(parseLegisPeriod(String(n))).toBe(roman);
      expect(parseLegisPeriod(roman)).toBe(roman);
      expect(parseLegisPeriod(` ${roman.toLowerCase()} `)).toBe(roman);
    }
  });

  it.each(['', ' ', '0', '41', '99', '-1', '1.5', 'IIII', 'VX', 'IXI', 'XXXXI', 'LX', 'abc', 'XXVIII!', '１２'])('rejects %j', (bad) => {
    expect(() => parseLegisPeriod(bad)).toThrow(/Gesetzgebungsperiode/);
  });

  it('rejects numbers that are not periods', () => {
    expect(() => parseLegisPeriod(0)).toThrow();
    expect(() => parseLegisPeriod(41)).toThrow();
    expect(() => parseLegisPeriod(Number.NaN)).toThrow();
  });
});

describe('windowText', () => {
  const paragraphs = Array.from({ length: 40 }, (_, i) => `Absatz ${i + 1}: ${'Wort '.repeat(20 + (i % 7) * 10)}`.trim());
  const text = paragraphs.join('\n\n');

  it('never exceeds the budget and always makes progress', () => {
    const next = rng(7);
    for (let run = 0; run < 200; run++) {
      const maxChars = 1 + next(900);
      const offset = next(text.length + 50);
      const w = windowText(text, offset, maxChars);
      expect(w.text.length).toBeLessThanOrEqual(maxChars);
      expect(w.total).toBe(text.length);
      expect(w.from).toBe(Math.min(offset, text.length));
      expect(w.to).toBeGreaterThanOrEqual(w.from);
      if (offset < text.length) expect(w.to).toBeGreaterThan(w.from);
    }
  });

  it('reading window after window gives back every paragraph exactly once, in order', () => {
    for (const maxChars of [200, 500, 1000, 4000]) {
      let offset = 0;
      const pieces: string[] = [];
      for (let guard = 0; guard < 10_000 && offset < text.length; guard++) {
        const w = windowText(text, offset, maxChars);
        pieces.push(w.text);
        offset = w.to;
      }
      expect(offset).toBe(text.length);
      const rebuilt = pieces.join(' ').replace(/\s+/g, ' ');
      expect(rebuilt).toBe(text.replace(/\s+/g, ' '));
    }
  });

  it('prefers to end at a paragraph break when one is reachable', () => {
    const w = windowText('aaaa\n\nbbbb\n\ncccc', 0, 12);
    expect(w.text).toBe('aaaa\n\nbbbb');
  });

  it('an offset past the end gives an empty window, not an error', () => {
    const w = windowText('kurz', 100, 50);
    expect(w).toMatchObject({ text: '', from: 4, to: 4, total: 4 });
  });

  it('handles empty input', () => {
    expect(windowText('', 0, 10)).toMatchObject({ text: '', total: 0 });
  });
});

describe('fetchSlice', () => {
  /** A server with `total` numbered rows and 50 rows per page. */
  const server = (total: number) => {
    const calls: number[] = [];
    return {
      calls,
      page: async (page: number) => {
        calls.push(page);
        const rows = Array.from({ length: PAGE_SIZE }, (_, i) => (page - 1) * PAGE_SIZE + i).filter((n) => n < total);
        return { total, rows, rawRows: rows.length };
      },
    };
  };

  it('returns exactly the requested range for random offsets, limits and totals', async () => {
    const next = rng(42);
    for (let run = 0; run < 300; run++) {
      const total = next(400);
      const offset = next(450);
      const limit = 1 + next(50);
      const s = server(total);
      const res = await fetchSlice(offset, limit, s.page);
      const expected = Array.from({ length: Math.max(0, Math.min(offset + limit, total) - offset) }, (_, i) => offset + i);
      expect(res.items).toEqual(expected);
      expect(res.total).toBe(total);
      expect(s.calls.length).toBeLessThanOrEqual(2); // limit <= 50 never needs more than two pages
    }
  });

  it('stops asking when a short page says it was the last one', async () => {
    const s = server(60);
    await fetchSlice(40, 50, s.page);
    expect(s.calls).toEqual([1, 2]);
    const t = server(10);
    await fetchSlice(0, 50, t.page);
    expect(t.calls).toEqual([1]);
  });

  it('crossing a page boundary asks for both pages and keeps the order', async () => {
    const s = server(500);
    const res = await fetchSlice(45, 10, s.page);
    expect(s.calls).toEqual([1, 2]);
    expect(res.items).toEqual([45, 46, 47, 48, 49, 50, 51, 52, 53, 54]);
  });
});

describe('isoFromDe', () => {
  it.each([
    ['27.10.2026', '2026-10-27'],
    [' 01.02.2003 ', '2003-02-01'],
  ])('%j -> %j', (input, iso) => expect(isoFromDe(input)).toBe(iso));

  it.each([['2026-10-27'], ['27.10.26'], ['27/10/2026'], [''], [null], [undefined], [20261027], [{}]])('%j -> null', (input) => {
    expect(isoFromDe(input)).toBeNull();
  });
});

describe('text helpers', () => {
  it('cleanText drops tags and keeps the text', () => {
    expect(cleanText('Arpa Claudia, Mag.<sup>a</sup>')).toBe('Arpa Claudia, Mag.a');
    expect(cleanText('  viel\n\n  Platz\t hier ')).toBe('viel Platz hier');
    expect(cleanText('<a href="x">Link</a> <br/> Ende')).toBe('Link Ende');
    expect(cleanText('')).toBe('');
  });

  it('cleanText decodes entities exactly once', () => {
    expect(cleanText('Erm&auml;chtigung &amp; &sect; 5 &ndash; &euro;')).toBe('Ermächtigung & § 5 – €');
    expect(cleanText('&amp;lt;')).toBe('&lt;');
    expect(cleanText('&#228;&#x00E4;&#xe4;')).toBe('äää');
    expect(cleanText('&#x1F600;')).toBe('😀');
    expect(cleanText('a&nbsp;b')).toBe('a b');
    expect(cleanText('wei&shy;ter')).toBe('weiter');
  });

  it('cleanText never leaves a complete tag behind, however the fragments are nested', () => {
    expect(cleanText('<scr<b>ipt>alert(1)</scr</b>ipt>')).not.toMatch(/<\s*\/?\s*script/i);
    expect(cleanText('<<b>b>x</b>')).not.toContain('<');
    const next = rng(11);
    const pieces = ['<', '>', '/', 'b', 'script', 'scr', 'ipt', ' ', 'a', '<b>', '</b>', '<i>', 'x'];
    for (let run = 0; run < 500; run++) {
      const input = Array.from({ length: 1 + next(14) }, () => pieces[next(pieces.length)]).join('');
      // without entities in the input, nothing that looks like a complete tag may survive
      expect(cleanText(input), JSON.stringify(input)).not.toMatch(/<[^>]*>/);
    }
  });

  it('cleanText leaves invalid or unknown entities as they are', () => {
    for (const odd of ['&unbekannt;', '&#0;', '&#99999999;', '&#xFFFFFFF;', '& und &', '&;', '&amp']) {
      expect(cleanText(odd)).toBe(odd);
    }
  });

  it('fold ignores case, diacritics and ß', () => {
    expect(fold('Östermayer')).toBe('ostermayer');
    expect(fold('  STRASSE ')).toBe('strasse');
    expect(fold('Straße')).toBe('strasse');
    expect(fold('Zoë Müller-Šimić')).toBe('zoe muller-simic');
  });

  it('truncate keeps short text and shortens long text at a word', () => {
    expect(truncate('kurz', 10)).toBe('kurz');
    expect(truncate('genau zehn', 10)).toBe('genau zehn');
    const long = 'Dies ist ein langer Satz mit vielen Wörtern darin, der gekürzt werden soll.';
    const cut = truncate(long, 30);
    expect(cut.endsWith(' […]')).toBe(true);
    expect(cut.length).toBeLessThanOrEqual(30 + 4);
    expect(long.startsWith(cut.slice(0, -4))).toBe(true);
  });

  it('truncate never produces something longer than max + marker, for any input', () => {
    const next = rng(3);
    const alphabet = 'ab cdé  fg\n';
    for (let run = 0; run < 300; run++) {
      const len = next(200);
      const s = Array.from({ length: len }, () => alphabet[next(alphabet.length)]).join('');
      const max = 1 + next(120);
      const out = truncate(s, max);
      expect(out.length).toBeLessThanOrEqual(Math.max(s.length <= max ? s.length : max + 4, 0));
      if (s.length <= max) expect(out).toBe(s);
    }
  });

  it('htmlAttr finds an attribute or returns null', () => {
    expect(htmlAttr('<span title="Schriftliche Anfrage" class="x">J</span>', 'title')).toBe('Schriftliche Anfrage');
    expect(htmlAttr('<span class="x">J</span>', 'title')).toBeNull();
    expect(htmlAttr('<span title="">J</span>', 'title')).toBeNull();
    expect(htmlAttr(null, 'title')).toBeNull();
    expect(htmlAttr(42, 'title')).toBeNull();
  });
});

describe('parseGegenstaende with odd rows', () => {
  const header = ['Betreff', 'INR', 'ITYP', 'Nummer', 'Datum', 'Art', 'DOKTYP_LANG', 'Abstimmungstext', 'THEMEN', 'SW', 'HIS_URL'];
  const row = (over: Partial<Record<string, unknown>> = {}) => {
    const base: Record<string, unknown> = {
      Betreff: 'Testgesetz',
      INR: 12,
      ITYP: 'I',
      Nummer: '12 d.B.',
      Datum: '01.02.2026',
      Art: 'RV',
      DOKTYP_LANG: 'Regierungsvorlage',
      Abstimmungstext: '',
      THEMEN: '["Verkehr"]',
      SW: '["Maut","",5]',
      HIS_URL: '/gegenstand/XXVIII/I/12',
      ...over,
    };
    return header.map((h) => base[h]);
  };

  it('skips rows without subject, number or type', () => {
    const items = parseGegenstaende(response(header, [row({ Betreff: '' }), row({ INR: null }), row({ ITYP: undefined }), row()]));
    expect(items).toHaveLength(1);
    expect(items[0]!.zitation).toBe('12/I');
  });

  it('turns a number into text and an absent vote into null', () => {
    const [it] = parseGegenstaende(response(header, [row({ INR: 7436, Abstimmungstext: '' })]));
    expect(it!.zitation).toBe('7436/I');
    expect(it!.abstimmung).toBeNull();
  });

  it('only accepts a site-relative link', () => {
    const [good] = parseGegenstaende(response(header, [row()]));
    expect(good!.url).toBe('https://www.parlament.gv.at/gegenstand/XXVIII/I/12');
    for (const bad of ['https://evil.example/x', 'javascript:alert(1)', '//evil.example', '', null, 5]) {
      const [it] = parseGegenstaende(response(header, [row({ HIS_URL: bad })]));
      // "//evil.example" starts with "/" - it must still end up on the Parliament's host
      if (it!.url !== null) expect(new URL(it!.url).host).toBe('www.parlament.gv.at');
      if (bad !== '//evil.example') expect(it!.url).toBeNull();
    }
  });

  it('survives broken or non-list JSON in the topic columns and drops non-strings', () => {
    const [a] = parseGegenstaende(response(header, [row({ THEMEN: 'not json', SW: '{"a":1}' })]));
    expect(a!.themen).toEqual([]);
    expect(a!.schlagworte).toEqual([]);
    const [b] = parseGegenstaende(response(header, [row()]));
    expect(b!.schlagworte).toEqual(['Maut']);
    const [c] = parseGegenstaende(response(header, [row({ THEMEN: null, SW: 7 })]));
    expect(c!.themen).toEqual([]);
  });

  it('formats an offset past the end and one-page results sensibly', () => {
    const q: GegenstaendeQuery = { gremium: 'NR', art: 'ANTR', limit: 10, offset: 40 };
    expect(formatGegenstaende({ total: 12, items: [] }, q)).toBe('Keine Treffer ab offset=40; es gibt insgesamt 12.');
    const [it] = parseGegenstaende(response(header, [row()]));
    const text = formatGegenstaende({ total: 1, items: [it!] }, { ...q, offset: 0 });
    expect(text).toContain('1 Treffer (Antrag');
    expect(text).toContain('angezeigt 1–1.');
    expect(text).not.toContain('Weitere mit offset');
  });
});

describe('parseSitzungen with odd rows', () => {
  const header = ['Gremium', 'GP', 'Datum', 'Betreff', 'col25', 'col28'];

  it('takes the session number from the link and ignores foreign links', () => {
    const rows = [
      ['NR', 'XXVIII', '16.06.2025', 'Budgetdebatte', 'Sitzung', '/gegenstand/XXVIII/NRSITZ/30'],
      ['NR', 'XXVIII', '17.06.2025', 'Fremd', 'Sitzung', 'https://evil.example/gegenstand/1'],
      ['BR', null, 'x', 'Ohne Link', null, null],
      ['NR', 'XXVIII', '18.06.2025', '', 'Sitzung', '/gegenstand/XXVIII/NRSITZ/32'],
    ];
    const items = parseSitzungen(response(header, rows));
    expect(items.map((i) => i.titel)).toEqual(['Budgetdebatte', 'Fremd', 'Ohne Link']);
    expect(items[0]).toMatchObject({ nummer: 30, datum: '2025-06-16', url: 'https://www.parlament.gv.at/gegenstand/XXVIII/NRSITZ/30' });
    expect(items[1]).toMatchObject({ nummer: null, path: null, url: null });
    expect(items[2]).toMatchObject({ gp: null, datum: null, art: null });
  });

  it('says why a page is empty', () => {
    const q = { gremium: 'NR' as const, limit: 10, offset: 0 };
    expect(formatSitzungen({ total: 0, items: [] }, q)).toContain('Keine Sitzungen gefunden');
    expect(formatSitzungen({ total: 5, items: [] }, { ...q, offset: 30 })).toBe('Keine Treffer ab offset=30; es gibt insgesamt 5.');
  });
});
