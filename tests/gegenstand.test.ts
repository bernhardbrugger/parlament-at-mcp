import { describe, expect, it } from 'vitest';
import { formatGegenstand, gegenstandPath, parseZitation } from '../src/tools/gegenstand.js';
import { detailSchema } from '../src/types.js';
import { parseLegisPeriod, toRoman } from '../src/legis-period.js';
import { clientWith, fixture, fixtureText, json } from './helpers.js';

describe('legislative periods', () => {
  it.each([[28, 'XXVIII'], [1, 'I'], [4, 'IV'], [9, 'IX'], [14, 'XIV'], [19, 'XIX'], [27, 'XXVII'], [39, 'XXXIX'], [40, 'XL']])('toRoman(%i) = %s', (n, roman) => {
    expect(toRoman(n)).toBe(roman);
  });

  it('parses numbers, strings and roman numerals in any case', () => {
    for (const input of [28, '28', 'XXVIII', 'xxviii', ' XXVIII ']) expect(parseLegisPeriod(input)).toBe('XXVIII');
  });

  it.each(['', '0', '41', '99', 'IIII', 'VX', 'ABC', 'XXVIII/J', '../..', '2e1'])('rejects %j', (input) => {
    expect(() => parseLegisPeriod(input)).toThrow(/Gesetzgebungsperiode/);
  });
});

describe('zitation and path', () => {
  it('parses citations', () => {
    expect(parseZitation('7436/J')).toEqual({ number: 7436, type: 'J' });
    expect(parseZitation(' 6209 / ab ')).toEqual({ number: 6209, type: 'AB' });
  });

  it.each(['7436', 'J/7436', '7436/', '7436/J/../x', '7436/J?x=1', '../../etc/passwd', '7436/<script>'])('rejects %j', (z) => {
    expect(() => parseZitation(z)).toThrow(/Zitation/);
  });

  it('builds the site path from validated parts only', () => {
    expect(gegenstandPath(28, '7436/J')).toBe('/gegenstand/XXVIII/J/7436');
    expect(gegenstandPath('xxvii', '12/ab')).toBe('/gegenstand/XXVII/AB/12');
  });
});

describe('detail pages (real fixtures)', () => {
  it('validate against the schema', () => {
    expect(detailSchema.safeParse(fixture('detail-j-7436.json')).success).toBe(true);
    expect(detailSchema.safeParse(fixture('detail-ab.json')).success).toBe(true);
  });

  it('format an inquiry with introducer, party and documents', () => {
    const text = formatGegenstand(fixture('detail-j-7436.json'), '/gegenstand/XXVIII/J/7436');
    expect(text).toContain('Schriftliche Anfrage · Nr. 7436/J · XXVIII. GP');
    expect(text).toContain('Eingelangt: 27.10.2026');
    expect(text).toContain('Eingebracht von: Peter Wurm (F)');
    expect(text).toContain('https://www.parlament.gv.at/person/83137');
    expect(text).toContain('Eingebracht an: Claudia Bauer (V), Büro der Bundesministerin für Europa, Integration und Familie');
    expect(text).toContain('Einlangen im Nationalrat (Frist: 27.12.2026)');
    expect(text).toContain('Anfrage (gescanntes Original) (PDF): https://www.parlament.gv.at/dokument/XXVIII/J/7436/');
    expect(text).toContain('Quelle: https://www.parlament.gv.at/gegenstand/XXVIII/J/7436');
  });

  it('format an answer with its reference, topics and headwords', () => {
    const text = formatGegenstand(fixture('detail-ab.json'), '/gegenstand/XXVIII/AB/6209');
    expect(text).toContain('Anfragebeantwortung');
    expect(text).toContain('Beantwortet durch: Mag. Gerhard Karner (V), Bundesministerium für Inneres');
    expect(text).toContain('Bezug:');
    expect(text).toContain('6817/J');
    expect(text).toContain('Themen: Inneres und Recht');
    expect(text).toContain('Schlagworte: Sicherheitswesen');
  });
});

describe('client.detail', () => {
  it('fetches the json twin of the page', async () => {
    const { client, fetchImpl } = clientWith(() => json(fixtureText('detail-j-7436.json')));
    const detail = await client.detail('/gegenstand/XXVIII/J/7436');
    expect(detail.content.zitation).toBe('7436/J');
    expect(fetchImpl.mock.calls[0]![0]).toBe('https://www.parlament.gv.at/gegenstand/XXVIII/J/7436?json=TRUE');
  });

  it('refuses paths that are not plain site paths', () => {
    const { client } = clientWith(() => json({}));
    for (const p of ['gegenstand/x', '/a/../b', '/a?b=1', 'https://evil.example/x']) {
      expect(() => client.detail(p)).toThrow(/Not a valid detail path/);
    }
  });
});
