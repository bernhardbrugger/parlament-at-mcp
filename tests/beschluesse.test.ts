import { describe, expect, it } from 'vitest';
import { formatBeschluesse, splitStages, stageText } from '../src/tools/beschluesse.js';
import { parseSession, type Session } from '../src/types.js';
import { fixture } from './helpers.js';

const path = '/gegenstand/XXVIII/NRSITZ/30';
const session = (): Session => parseSession(fixture('session-nr-xxviii-30.json'));

describe('session decisions (real fixture, 30th session)', () => {
  it('parses decisions, press releases and agenda documents from the metadata block', () => {
    const s = session();
    expect(s.resolutions.map((r) => r.top)).toEqual(['TOP 2', 'TOP 3', 'TOP 4', 'TOP 5']);
    expect(s.correspondence).toHaveLength(6);
    expect(s.correspondence[0]).toMatchObject({ date: '13.06.2025', url: '/aktuelles/pk/jahr_2025/pk0533#XXVIII_NRSITZ_00030' });
    expect(s.agenda[0]!.title).toBe('Tagesordnung vom 16.06.2025');
    expect(s.agenda[0]!.links.map((l) => l.type)).toEqual(['PDF', 'HTML']);
  });

  it('shows what the plenary decided, with the vote by party', () => {
    const text = formatBeschluesse(session(), 30, path);
    expect(text).toContain('4 von 4 Tagesordnungspunkten mit Beschlüssen:');
    expect(text).toContain('TOP 2 — Budgetbegleitgesetz 2025 (100 d.B.)');
    expect(text).toContain('https://www.parlament.gv.at/gegenstand/XXVIII/I/100');
    expect(text).toContain(
      '✔ 30. Sitzung des Nationalrates: Gesetzesvorschlag in dritter Lesung angenommen · Dafür: ÖVP, SPÖ, NEOS, dagegen: FPÖ, GRÜNE',
    );
    expect(text).toContain('Getrennte Abstimmung (mehrstimmig (dafür: V, S, N, G bzw. V, S, N))');
  });

  it('leaves committee stages out (parl_gegenstand has the full procedure)', () => {
    const text = formatBeschluesse(session(), 30, path);
    expect(text).not.toContain('Budgetausschuss: Abänderungsantrag');
    expect(text).not.toContain('Ausschuss für Wissenschaft');
  });

  it('adds what happened afterwards, e.g. the Bundesrat', () => {
    const text = formatBeschluesse(session(), 30, path);
    expect(text).toContain(
      'danach (26.06.2025): 979. Sitzung: Antrag, keinen Einspruch zu erheben, angenommen · Dafür: ÖVP, SPÖ, NEOS, dagegen: FPÖ, GRÜNE',
    );
  });

  it('does not repeat the same decision when several materials carry it', () => {
    const text = formatBeschluesse(session(), 30, path, { top: 'TOP 2' });
    expect(text.split('Gesetzesvorschlag in dritter Lesung angenommen').length - 1).toBe(1);
  });

  it('lists press releases and agenda documents with links', () => {
    const text = formatBeschluesse(session(), 30, path);
    expect(text).toContain('Parlamentskorrespondenz zur Sitzung:');
    expect(text).toContain(
      '13.06.2025: Parlament: TOP im Nationalrat am 16. Juni 2025 — https://www.parlament.gv.at/aktuelles/pk/jahr_2025/pk0533',
    );
    expect(text).toContain('Tagesordnung vom 16.06.2025: https://www.parlament.gv.at/dokument/XXVIII/NRSITZ/30/TO_16447526.html');
    expect(text).toContain('Quelle: https://www.parlament.gv.at/gegenstand/XXVIII/NRSITZ/30');
  });

  it('filters agenda items by number or title, ignoring case and umlauts', () => {
    expect(formatBeschluesse(session(), 30, path, { top: 'TOP 3' })).toContain('1 von 4');
    const uni = formatBeschluesse(session(), 30, path, { top: 'UNIVERSITÄTSGESETZ' });
    expect(uni).toContain('TOP 5');
    expect(uni).not.toContain('TOP 2 —');
    expect(formatBeschluesse(session(), 30, path, { top: 'Zzzz' })).toContain('Kein Tagesordnungspunkt passt zu "Zzzz"');
  });

  it('says so when a session has no decisions yet', () => {
    const empty: Session = { ...session(), resolutions: [] };
    expect(formatBeschluesse(empty, 30, path)).toContain('(noch) keine Beschlüsse');
  });

  it('reports a missing plenary decision for another session number', () => {
    const text = formatBeschluesse(session(), 31, path, { top: 'TOP 2' });
    expect(text).toContain('(kein Plenarbeschluss in dieser Sitzung verzeichnet)');
  });

  it('caps very long output and keeps the footer', () => {
    const big: Session = {
      ...session(),
      resolutions: Array.from({ length: 400 }, (_, i) => ({
        top: `TOP ${i}`,
        text: 'x'.repeat(100),
        zitation: `${i} d.B.`,
        url: `/gegenstand/XXVIII/I/${i}`,
        materials: [],
      })),
    };
    const text = formatBeschluesse(big, 30, path);
    expect(text.length).toBeLessThanOrEqual(20_100);
    expect(text).toContain('gekürzt');
  });
});

describe('stage helpers', () => {
  it('turns HTML stages into one readable line', () => {
    expect(
      stageText(
        '<a href="/gegenstand/XXVIII/NRSITZ/103">103. Sitzung des Nationalrates</a>: Antrag <b>angenommen</b><br>Dafür: ÖVP, dagegen: FPÖ',
      ),
    ).toBe('103. Sitzung des Nationalrates: Antrag angenommen · Dafür: ÖVP, dagegen: FPÖ');
    expect(stageText('a<br /><br/>b<br>')).toBe('a · b');
  });

  it('does not mistake 103 for 3 when matching the session number', () => {
    const r = {
      top: 'TOP 1',
      materials: [{ stages: [{ date: '15.10.2026', text: '<a href="/x">103. Sitzung des Nationalrates</a>: angenommen' }] }],
    };
    expect(splitStages(r, 3, '15.10.2026').plenary).toHaveLength(0);
    expect(splitStages(r, 103, '15.10.2026').plenary).toHaveLength(1);
  });

  it('tolerates items without materials or stages', () => {
    expect(splitStages({ top: 'TOP 1' }, 30, '16.06.2025')).toEqual({ plenary: [], later: [] });
    expect(splitStages({ materials: [{}, { stages: null }] }, 30, null)).toEqual({ plenary: [], later: [] });
  });

  it('survives malformed optional blocks on the session page', () => {
    const raw = fixture('session-nr-xxviii-30.json');
    raw.content[0].resolutions = 'broken';
    raw.content[0].correspondence = { not: 'a list' };
    raw.content[0].agenda = 42;
    const s = parseSession(raw);
    expect(s.resolutions).toEqual([]);
    expect(s.correspondence).toEqual([]);
    expect(s.agenda).toEqual([]);
    expect(s.title).toContain('30. Sitzung');
  });
});
