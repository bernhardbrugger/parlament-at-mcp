import { describe, expect, it } from 'vitest';
import { parseSpeechHtml, windowText } from '../src/speech.js';
import { formatRede, locateSpeech, DEFAULT_CHARS } from '../src/tools/rede.js';
import { formatSitzung, sitzungPath } from '../src/tools/sitzung.js';
import { parseSession, type Session } from '../src/types.js';
import { clientWith, fixture, fixtureText, json } from './helpers.js';

const SPEECH = 'speech-kickl-A_-_11_12_46_00801352.html';
const session = () => parseSession(fixture('session-nr-xxviii-30.json'));

describe('session page (real fixture)', () => {
  it('is parsed from the three-block content array', () => {
    const s = session();
    expect(s.title).toBe('30. Sitzung des Nationalrats der XXVIII. GP am 16. Juni 2025');
    expect(s.zitation).toBe('30/NRSITZ');
    expect(s.gp).toBe('XXVIII');
    expect(s.start).toBe('2025-06-16T09:05:00');
    expect(s.state).toBe('fertig');
    expect(s.protocols[0]!.title).toBe('Stenographisches Protokoll');
    expect(s.protocols[0]!.links.map((l) => l.type)).toEqual(['PDF', 'HTML']);
    expect(s.progress.map((p) => p.text.split(' ')[0])).toEqual(['Sitzungsbeginn', 'Präsidium', 'TOP', 'TOP', 'Dringliche', 'Sitzungsende']);
  });

  it('tolerates a page without the optional blocks', () => {
    const s = parseSession({ content: [{ title: 'x', zitation: '1/NRSITZ' }] });
    expect(s.progress).toEqual([]);
    expect(s.protocols).toEqual([]);
    expect(s.title).toBe('x');
  });
});

describe('sitzungPath', () => {
  it('builds National Council and Federal Council paths', () => {
    expect(sitzungPath('NR', 28, 30)).toBe('/gegenstand/XXVIII/NRSITZ/30');
    expect(sitzungPath('BR', undefined, 997)).toBe('/gegenstand/BR/BRSITZ/997');
  });

  it('needs a legislative period for the National Council and validates it', () => {
    expect(() => sitzungPath('NR', undefined, 30)).toThrow(/Gesetzgebungsperiode/);
    expect(() => sitzungPath('NR', '../x', 30)).toThrow(/Gesetzgebungsperiode/);
  });
});

describe('formatSitzung (outline)', () => {
  it('lists agenda items with times and all speakers of a short session', () => {
    const text = formatSitzung(session(), '/gegenstand/XXVIII/NRSITZ/30');
    expect(text).toContain('30. Sitzung des Nationalrats');
    expect(text).toContain('Gesamtes Protokoll');
    expect(text).toContain('https://www.parlament.gv.at/dokument/XXVIII/NRSITZ/30/imfname_1739891.pdf');
    expect(text).toContain('Verlauf (6 Punkte, 12 Redebeiträge)');
    expect(text).toContain('11:11:48  TOP 2-4 Debatte zum Budgetbegleitgesetz 2025 — 6 Redebeiträge');
    expect(text).toContain('Herbert Kickl (FPÖ) · rede=801352');
    expect(text).toContain('Quelle: https://www.parlament.gv.at/gegenstand/XXVIII/NRSITZ/30');
  });

  it('filters by speaker across agenda items', () => {
    const text = formatSitzung(session(), 'p', { redner: 'kucher' });
    expect(text).toContain('Philip Kucher (SPÖ) · rede=801405');
    expect(text).not.toContain('Herbert Kickl (FPÖ) · rede');
    expect(text).not.toContain('Sitzungsende');
  });

  it('says so when a speaker did not speak', () => {
    expect(formatSitzung(session(), 'p', { redner: 'Nobody Atall' })).toContain('Keine Wortmeldung von "Nobody Atall"');
  });

  it('filters agenda items by title, ignoring case and umlauts', () => {
    const text = formatSitzung(session(), 'p', { top: 'BUDGETBEGLEIT' });
    expect(text).toContain('TOP 2-4');
    expect(text).not.toContain('Dringliche Anfrage');
  });

  it('lists speeches only on request for long sessions, and caps the output', () => {
    const many: Session = {
      ...session(),
      progress: Array.from({ length: 300 }, (_, i) => ({
        text: `TOP ${i} ${'x'.repeat(60)}`,
        time: '10:00:00',
        speeches: Array.from({ length: 2 }, (_, j) => ({ texta: `Redner ${i}-${j} (X)`, st_objekte_id: i * 10 + j })),
      })),
    };
    const text = formatSitzung(many, 'p');
    expect(text).toContain('mit top= (Teil des Tagesordnungspunkts) oder redner= (Name) eingrenzen');
    expect(text).not.toContain('rede=3');
    const forced = formatSitzung(many, 'p', { redner: 'Redner' });
    expect(forced.length).toBeLessThanOrEqual(20_100);
    expect(forced).toContain('gekürzt');
  });
});

describe('speech segment (real fixture)', () => {
  const html = fixtureText(SPEECH);

  it('reads speaker and times from the markers and text from the paragraphs', () => {
    const sp = parseSpeechHtml(html);
    expect(sp.speaker).toBe('Herbert Kickl (FPÖ)');
    expect(sp.start).toBe('11.12');
    expect(sp.paragraphs.length).toBeGreaterThan(10);
    expect(sp.paragraphs[0]).toMatch(/^Abgeordneter Herbert Kickl \(FPÖ\): Danke schön, Herr Präsident!/);
    expect(sp.paragraphs.join(' ')).not.toMatch(/RN\/\d+/);
    expect(sp.paragraphs.join(' ')).not.toMatch(/<|>/);
  });

  it('keeps interjections by default and can cut them out', () => {
    const withIj = parseSpeechHtml(html).paragraphs.join('\n');
    const without = parseSpeechHtml(html, { interjections: false }).paragraphs.join('\n');
    expect(withIj).toContain('(Beifall bei der FPÖ.');
    expect(withIj).toContain('Abg. Michael Hammer [ÖVP]: Na bravo!');
    expect(without).not.toContain('Beifall bei der FPÖ');
    expect(without).not.toContain('Na bravo');
    expect(without.length).toBeLessThan(withIj.length);
    expect(without).toContain('Ich rede vom Staatsbesuch'); // the speech itself stays
  });
});

describe('windowText', () => {
  const text = Array.from({ length: 40 }, (_, i) => `Absatz ${i} ${'wort '.repeat(30)}`.trim()).join('\n\n');

  it('cuts at a paragraph break and reads the whole text without gaps', () => {
    let offset = 0;
    const parts: string[] = [];
    for (let guard = 0; guard < 50; guard++) {
      const w = windowText(text, offset, 1000);
      expect(w.from).toBe(offset);
      expect(w.text.length).toBeLessThanOrEqual(1000);
      parts.push(w.text);
      if (w.to >= w.total) break;
      expect(text.slice(w.to, w.to + 2)).toBe('\n\n');
      offset = w.to;
    }
    expect(parts.join('\n\n').replace(/\s+/g, ' ')).toBe(text.replace(/\s+/g, ' '));
  });

  it('returns empty text past the end', () => {
    expect(windowText('abc', 10, 100)).toMatchObject({ text: '', total: 3 });
  });
});

describe('locateSpeech and formatRede', () => {
  it('finds a speech by its number and the HTML segment path', () => {
    expect(locateSpeech(session(), 801352)).toMatchObject({
      speaker: 'Herbert Kickl (FPÖ)',
      top: 'TOP 2-4 Debatte zum Budgetbegleitgesetz 2025',
      htmlPath: '/dokument/XXVIII/NRSITZ/30/A_-_11_12_46_00801352.html',
    });
  });

  it('also finds plain agenda entries, and returns null for unknown numbers', () => {
    expect(locateSpeech(session(), 801166)?.top).toBe('Sitzungsbeginn');
    expect(locateSpeech(session(), 1)).toBeNull();
  });

  const located = locateSpeech(session(), 801352)!;
  const common = { located, sessionTitle: '30. Sitzung', protocolNote: null, html: fixtureText(SPEECH), interjections: true, offset: 0 };

  it('formats a short window with source, position and a continuation hint', () => {
    const text = formatRede({ ...common, maxChars: 3000 });
    expect(text).toContain('Herbert Kickl (FPÖ) · 11.12');
    expect(text).toContain('30. Sitzung · TOP 2-4 Debatte zum Budgetbegleitgesetz 2025');
    expect(text).toContain('Quelle: https://www.parlament.gv.at/dokument/XXVIII/NRSITZ/30/A_-_11_12_46_00801352.html');
    expect(text).toMatch(/\[Zeichen 1–\d+ von \d+; weiterlesen mit offset=\d+\]/);
  });

  it('reads a speech to the end across calls', () => {
    let offset = 0;
    let last = '';
    for (let guard = 0; guard < 20; guard++) {
      last = formatRede({ ...common, offset, maxChars: 6000 });
      const m = /weiterlesen mit offset=(\d+)/.exec(last);
      if (!m) break;
      offset = Number(m[1]);
    }
    expect(last).toMatch(/\[Ende der Rede, \d+ Zeichen\]/);
  });

  it('delivers a normal speech in one piece within the default budget', () => {
    const text = formatRede({ ...common, maxChars: DEFAULT_CHARS });
    expect(text).toMatch(/\[Ende der Rede/);
    expect(text.length).toBeLessThan(45_000);
  });

  it('passes on the Parliament\'s notes', () => {
    const text = formatRede({ ...common, maxChars: 3000, protocolNote: 'Mit KI-Unterstützung erstellt.', located: { ...located, autorisiert: false } });
    expect(text).toContain('Hinweis des Parlaments: Mit KI-Unterstützung erstellt.');
    expect(text).toContain('noch nicht autorisiert');
  });
});

describe('client.session / client.document', () => {
  it('fetches and caches the session JSON', async () => {
    const { client, fetchImpl } = clientWith(() => json(fixtureText('session-nr-xxviii-30.json')));
    const a = await client.session('/gegenstand/XXVIII/NRSITZ/30');
    const b = await client.session('/gegenstand/XXVIII/NRSITZ/30');
    expect(a.title).toContain('30. Sitzung');
    expect(b).toBe(a);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]![0]).toBe('https://www.parlament.gv.at/gegenstand/XXVIII/NRSITZ/30?json=TRUE');
  });

  it('accepts only plain session and protocol document paths', async () => {
    const { client } = clientWith(() => json({}));
    for (const p of ['/gegenstand/XXVIII/NRSITZ/30/../1', '/gegenstand/XXVIII/J/30', '/gegenstand/XXVIII/NRSITZ/x', 'https://evil.example/x', '/gegenstand/XXVIII/NRSITZ/30?x=1']) {
      expect(() => client.session(p)).toThrow(/Not a valid session path/);
    }
    for (const p of ['/dokument/XXVIII/NRSITZ/30/../../x.html', '/dokument/XXVIII/NRSITZ/30/a.pdf', '/dokument/XXVIII/J/30/a.html', '/foo/a.html', '//evil.example/a.html']) {
      await expect(client.document(p)).rejects.toThrow(/Not a valid protocol document path/);
    }
  });
});
