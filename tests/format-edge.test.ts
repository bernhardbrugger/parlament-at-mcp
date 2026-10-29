import { describe, expect, it } from 'vitest';
import { parseSpeechHtml } from '../src/speech.js';
import { formatGegenstand, gegenstandPath, parseZitation } from '../src/tools/gegenstand.js';
import { formatRede, locateSpeech, type Located } from '../src/tools/rede.js';
import type { DetailResponse, Session } from '../src/types.js';

const detail = (content: unknown) => ({ content }) as unknown as DetailResponse;

describe('parseZitation / gegenstandPath', () => {
  it.each([
    ['7436/J', { number: 7436, type: 'J' }],
    [' 6209 / ab ', { number: 6209, type: 'AB' }],
    ['251/I', { number: 251, type: 'I' }],
    ['1/NRSITZ', { number: 1, type: 'NRSITZ' }],
  ])('%j', (input, expected) => expect(parseZitation(input)).toEqual(expected));

  it.each(['', '7436', 'J/7436', '7436/', '/J', '1234567/J', '12/ABCDEFG', '12/J/3', '12/1', '../../etc/passwd', '12/J?x=1'])(
    'rejects %j',
    (bad) => {
      expect(() => parseZitation(bad)).toThrow(/Ungültige Zitation/);
    },
  );

  it('builds a path from validated parts only', () => {
    expect(gegenstandPath(28, '7436/j')).toBe('/gegenstand/XXVIII/J/7436');
    expect(gegenstandPath('xxvii', '1/AB')).toBe('/gegenstand/XXVII/AB/1');
    expect(() => gegenstandPath('nope', '1/AB')).toThrow(/Gesetzgebungsperiode/);
    expect(() => gegenstandPath(28, '../x')).toThrow(/Zitation/);
  });
});

describe('formatGegenstand with sparse and rich pages', () => {
  const path = '/gegenstand/XXVIII/J/1';

  it('falls back to the path when the page has nothing', () => {
    const text = formatGegenstand(detail({}), path);
    expect(text.split('\n')[0]).toBe(path);
    expect(text).toContain('Quelle: https://www.parlament.gv.at/gegenstand/XXVIII/J/1');
  });

  it('shows involved people with party, organisation and an absolute link', () => {
    const text = formatGegenstand(
      detail({
        title: 'Anfrage an den <b>Finanzminister</b>',
        type: 'Schriftliche Anfrage',
        zitation: '1/J',
        gp_code: 'XXVIII',
        einlangen: '2025-03-04T00:00:00',
        names: [
          { name: 'Muster, Max', funktext: 'Anfragesteller', frak_code: 'FPÖ', url: '/person/5' },
          { name: 'Beispiel, Eva', ltext: 'Bundesministerium für Finanzen', url: 'https://example.org/x' },
          { name: 'Ohne Rolle' },
        ],
        description: 'Kurzer Text',
      }),
      path,
    );
    expect(text).toContain('Anfrage an den Finanzminister');
    expect(text).toContain('Schriftliche Anfrage · Nr. 1/J · XXVIII. GP');
    expect(text).toContain('Eingelangt: 04.03.2025');
    expect(text).toContain('- Anfragesteller: Muster, Max (FPÖ) — https://www.parlament.gv.at/person/5');
    expect(text).toContain('- Beteiligt: Beispiel, Eva, Bundesministerium für Finanzen — https://example.org/x');
    expect(text).toContain('- Beteiligt: Ohne Rolle');
    expect(text).toContain('Kurzer Text');
  });

  it('lists stages, documents (relative and absolute), references, topics and keywords', () => {
    const text = formatGegenstand(
      detail({
        title: 'Test',
        stages: [{ date: '01.02.2025', text: 'Eingebracht' }, { text: 'Ohne Datum' }],
        documents: [
          { title: 'Anfrage', documents: [{ link: '/dokument/a.pdf', type: 'PDF' }, { link: 'https://www.parlament.gv.at/b.html' }] },
          { documents: [{ link: 'c.pdf' }] },
          { title: 'Leer' },
        ],
        reference: [
          { text: 'Beantwortung', zitation: '2/AB', subject: 'Betreff <i>x</i>', url: '/gegenstand/XXVIII/AB/2' },
          { text: 'Nur Text' },
        ],
        topics: { data: { bubbles: [{ label: 'Finanzen' }, { label: 'Steuern' }] } },
        headwords: { data: { bubbles: [{ label: 'Budget' }] } },
      }),
      path,
    );
    expect(text).toContain('- 01.02.2025: Eingebracht');
    expect(text).toContain('- Ohne Datum');
    expect(text).toContain('- Anfrage (PDF): https://www.parlament.gv.at/dokument/a.pdf');
    expect(text).toContain('- Anfrage: https://www.parlament.gv.at/b.html');
    expect(text).toContain('- Dokument: https://www.parlament.gv.at/c.pdf');
    expect(text).toContain('- Beantwortung 2/AB — Betreff x https://www.parlament.gv.at/gegenstand/XXVIII/AB/2');
    expect(text).toContain('- Nur Text');
    expect(text).toContain('Themen: Finanzen, Steuern');
    expect(text).toContain('Schlagworte: Budget');
  });

  it('for bills: status without the placeholder link, vote and the procedure phases', () => {
    const text = formatGegenstand(
      detail({
        title: 'Gesetz',
        status: {
          description: 'Beschlossen<br>im Bundesrat<br/><br/>Einstimmig',
          bgbllinks: [
            { title: 'Kunsttext', link: '/x' },
            { title: 'BGBl. I Nr. 1/2025', link: 'https://www.ris.bka.gv.at/bgbl' },
            { link: '/ohne-titel' },
          ],
        },
        vote: { text: 'Dafür: F, V' },
        shortinfo: { teil1: '<ul><li>Erster</li><li> </li></ul>', teil2: '<ul><li>Zweiter</li></ul>' },
        phase: [{ name: 'Ausschuss', stages: [{ date: '03.03.2025', text: 'a<br>b' }, { text: 'c' }] }, { stages: [] }, {}],
      }),
      path,
    );
    expect(text).toContain('Stand: Beschlossen · im Bundesrat · Einstimmig');
    expect(text).toContain('  BGBl. I Nr. 1/2025: https://www.ris.bka.gv.at/bgbl');
    expect(text).not.toContain('Kunsttext');
    expect(text).toContain('Abstimmung: Dafür: F, V');
    expect(text).toContain('Kurzinformation:\n- Erster');
    expect(text).toContain('- Zweiter');
    expect(text).not.toMatch(/Kurzinformation:[\s\S]*Kurzinformation:/);
    expect(text).toContain('Ausschuss:\n- 03.03.2025: a · b\n- c');
    expect(text).toContain('Verfahrensschritt:');
  });
});

describe('locateSpeech', () => {
  const html = (link: string) => ({
    data: {
      links: [
        {
          documents: [
            { link: '/x.pdf', type: 'PDF' },
            { link, type: 'html' },
          ],
        },
      ],
    },
  });
  const session = {
    progress: [
      {
        text: 'TOP 1',
        speeches: [
          { st_objekte_id: 11, texta: 'Rede <b>A</b>', time: '09:00', protocol: html('/dokument/a.html'), autorisiert: false },
          { st_objekte_id: 12, texta: 'Rede B', protocol: { data: { links: [{ documents: [{ link: '/y.pdf', type: 'PDF' }] }] } } },
        ],
      },
      { text: 'TOP 2', st_objekte_id: 20, time: '10:00', protocol: html('/dokument/top2.html') },
      { text: 'TOP 3', st_objekte_id: 30 },
    ],
  } as unknown as Session;

  it('finds a speech and reads its HTML segment, speaker and authorisation', () => {
    expect(locateSpeech(session, 11)).toEqual({
      speaker: 'Rede A',
      time: '09:00',
      top: 'TOP 1',
      htmlPath: '/dokument/a.html',
      autorisiert: false,
    });
  });

  it('also finds protocol entries that are not speeches', () => {
    expect(locateSpeech(session, 20)).toMatchObject({ speaker: 'TOP 2', top: 'TOP 2', htmlPath: '/dokument/top2.html', autorisiert: null });
  });

  it('returns null when there is no HTML segment or no such id', () => {
    expect(locateSpeech(session, 12)).toBeNull(); // only a PDF
    expect(locateSpeech(session, 30)).toBeNull(); // no protocol at all
    expect(locateSpeech(session, 999)).toBeNull();
  });
});

describe('formatRede', () => {
  const located: Located = { speaker: 'Kickl Herbert', time: '11:12', top: 'TOP 1', htmlPath: '/dokument/a.html', autorisiert: null };
  const args = { located, sessionTitle: '30. Sitzung', protocolNote: null, interjections: true, offset: 0, maxChars: 30_000 };
  const speech =
    '<p class="randnummer" title="Herbert Kickl (FPÖ)"></p><p class="_RB">11.12</p><p>Erster Absatz.</p><p>Zweiter <i>(Beifall)</i> Absatz.</p><p class="_RE">11.20</p>';

  it('prints the speaker, session, source and the text with the end marker', () => {
    const text = formatRede({ ...args, html: speech });
    const lines = text.split('\n');
    expect(lines[0]).toBe('Herbert Kickl (FPÖ) · 11.12–11.20');
    expect(lines[1]).toBe('30. Sitzung · TOP 1');
    expect(text).toContain('Quelle: https://www.parlament.gv.at/dokument/a.html');
    expect(text).toContain('[1] Erster Absatz.\n\n[2] Zweiter (Beifall) Absatz.');
    expect(text).toContain('[Ende der Rede, ');
    expect(text).not.toContain('ohne Zwischenrufe');
  });

  it('can leave out interjections and says so', () => {
    const text = formatRede({ ...args, html: speech, interjections: false });
    expect(text).toContain('Zweiter  Absatz.'.replace('  ', ' '));
    expect(text).not.toContain('Beifall');
    expect(text).toContain('ohne Zwischenrufe]');
  });

  it('falls back to the session data when the segment names nobody and has no times', () => {
    const text = formatRede({ ...args, html: '<p>Nur Text</p>' });
    expect(text.split('\n')[0]).toBe('Kickl Herbert · 11:12');
    expect(formatRede({ ...args, located: { ...located, time: null }, html: '<p>Nur Text</p>' }).split('\n')[0]).toBe('Kickl Herbert');
  });

  it('shows only the start time when the end is missing', () => {
    expect(formatRede({ ...args, html: '<p class="_RB">9.00</p><p>x</p>' }).split('\n')[0]).toBe('Kickl Herbert · 9.00');
  });

  it('warns about unauthorised speeches and passes on the Parliament’s note', () => {
    const text = formatRede({ ...args, located: { ...located, autorisiert: false }, protocolNote: 'Erstellt <b>mit KI</b>', html: speech });
    expect(text).toContain('noch nicht autorisiert');
    expect(text).toContain('Hinweis des Parlaments: Erstellt mit KI');
  });

  it('says so for a speech without text', () => {
    const text = formatRede({ ...args, html: '<p class="randnummer" title="A"></p>' });
    expect(text).toContain('(Der Redebeitrag enthält keinen Text.)');
    expect(text).not.toContain('Zeichen');
  });

  it('pages through a long speech with an offset that continues exactly where the last window ended', () => {
    const para = (n: number) => `<p>${`Satz${n} `.repeat(120).trim()}</p>`;
    const html = Array.from({ length: 12 }, (_, i) => para(i)).join('');
    const first = formatRede({ ...args, html, maxChars: 2_000 });
    const m = /weiterlesen mit offset=(\d+)\]/.exec(first);
    expect(m).not.toBeNull();
    const second = formatRede({ ...args, html, maxChars: 2_000, offset: Number(m![1]) });
    expect(second).toMatch(/\[Zeichen \d+–\d+ von \d+/);
    // no overlap and no gap between the two windows
    const firstBody = first.split('\n\n').slice(1, -1).join('\n\n');
    const secondBody = second.split('\n\n').slice(1, -1).join('\n\n');
    expect(firstBody.length + secondBody.length).toBeLessThanOrEqual(4_000);
    expect(secondBody.startsWith(firstBody.slice(0, 5))).toBe(false);
  });
});

describe('parseSpeechHtml', () => {
  it('returns nulls and no paragraphs for an empty page', () => {
    expect(parseSpeechHtml('')).toEqual({ speaker: null, start: null, end: null, paragraphs: [] });
  });

  it('ignores scripts and styles and collapses whitespace', () => {
    const s = parseSpeechHtml('<style>p{}</style><script>var x=1</script><h2>Titel   hier</h2><ul><li> Punkt\n eins </li></ul>');
    expect(s.paragraphs).toEqual(['Titel hier', 'Punkt eins']);
  });
});
