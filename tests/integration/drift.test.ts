/**
 * Live canary: does the Parliament's undocumented interface still look the way the parsers expect?
 * Fails with a precise message when a list loses a column or a detail page changes shape - before users notice.
 * Run: npm run test:integration   (about 15 requests, one per second; never part of `npm test`)
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { ParlamentClient } from '../../src/client.js';
import { parseAnfragen } from '../../src/tools/anfragen.js';
import { parseAusschuesse } from '../../src/tools/ausschuesse.js';
import { parseGegenstaende } from '../../src/tools/gegenstaende.js';
import { parseReden } from '../../src/tools/person.js';
import { parseSitzungen } from '../../src/tools/sitzungen.js';
import { detailSchema, personSchema, rowsToObjects, type FilterResponse } from '../../src/types.js';

const client = new ParlamentClient({ userAgent: 'parlament-at-mcp-canary (+https://github.com/bernhardbrugger/parlament-at-mcp)' });

function labels(resp: FilterResponse): string[] {
  return Object.keys(rowsToObjects(resp)[0] ?? {});
}

describe('list endpoints keep the columns the parsers read', () => {
  it('persons (10400)', async () => {
    const resp = await client.filterData(10400);
    expect(resp.count).toBeGreaterThan(3000);
    expect(labels(resp)).toEqual(expect.arrayContaining(['persart', 'Funktion', 'pad_intern', 'Name', 'geschl', 'portrait']));
  });

  it('inquiries (WFP_005)', async () => {
    const resp = await client.filterPost('WFP_005', { NRBR: ['NR'], GP: ['XXVIII'], JMAB: ['J_JPR_M'] }, { page: 1 });
    expect(labels(resp)).toEqual(expect.arrayContaining(['Aktualisierung', 'Art', 'Betreff', 'Nr.', 'Status', 'link']));
    const items = parseAnfragen(resp);
    expect(items.length).toBeGreaterThan(10);
    expect(items[0]!.url).toMatch(/^https:\/\/www\.parlament\.gv\.at\/gegenstand\/XXVIII\/J\/\d+$/);
  });

  it('items (101)', async () => {
    const resp = await client.filterDataPost(101, { NRBR: ['NR'], GP_CODE: ['XXVIII'], VHG: ['RV'] }, { page: 1, pagesize: 5 });
    expect(labels(resp)).toEqual(expect.arrayContaining(['ITYP', 'INR', 'Betreff', 'HIS_URL', 'Datum', 'Nummer']));
    expect(parseGegenstaende(resp)[0]!.zitation).toMatch(/^\d+\/I$/);
  });

  it('sessions (701)', async () => {
    const resp = await client.filterDataPost(
      701,
      { GREMIUM: ['NR'], GP_CODE: ['XXVIII'], SIAKT: ['SI'] },
      { page: 1, pagesize: 5, sortrnr: 22, ascDesc: 'DESC' },
    );
    const items = parseSitzungen(resp);
    expect(items.length).toBe(5);
    expect(items[0]!.path).toMatch(/^\/gegenstand\/XXVIII\/NRSITZ\/\d+$/);
    expect(items[0]!.datum).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('current members (WFW_002, WFW_005)', async () => {
    const body = { M: ['M'], W: ['W'] };
    const nr = await client.filterPost('WFW_002', body, { all: true });
    expect(nr.count).toBeGreaterThan(150);
    expect(labels(nr)).toEqual(expect.arrayContaining(['Name', 'Klub', 'Wahlkreis', 'Bundesland', 'link']));
    expect(String(rowsToObjects(nr)[0]!['link'])).toMatch(/^\/person\/\d+$/);
    const br = await client.filterPost('WFW_005', body, { all: true });
    expect(br.count).toBeGreaterThan(40);
    expect(labels(br)).toEqual(expect.arrayContaining(['pad_intern', 'Name', 'Fraktion', 'Wahlkreis', 'Bundesland']));
  });

  it('committees (WFP_009)', async () => {
    const resp = await client.filterPost('WFP_009', { NRBR: ['NR'], GP: ['XXVIII'] }, { all: true });
    const items = parseAusschuesse(resp);
    expect(items.length).toBeGreaterThan(20);
    expect(items.every((i) => i.path !== null)).toBe(true);
  });

  it('speeches of a person (251)', async () => {
    const resp = await client.filterDataPost(251, { PAD_INTERN: ['91034'] }, { page: 1, pagesize: 5, sortrnr: 10, ascDesc: 'DESC' });
    const items = parseReden(resp);
    expect(items).toHaveLength(5);
    expect(items[0]!.sitzung).toBeGreaterThan(0);
  });
});

describe('detail pages keep their shape', () => {
  let session: Awaited<ReturnType<ParlamentClient['session']>>;
  beforeAll(async () => {
    session = await client.session('/gegenstand/XXVIII/NRSITZ/30');
  });

  it('an inquiry names who introduced it, with party', async () => {
    const d = await client.detail('/gegenstand/XXVIII/J/7436');
    expect(detailSchema.parse(d).content.names?.[0]).toMatchObject({ funktext: 'Eingebracht von', frak_code: expect.any(String) });
  });

  it('a bill has procedure phases and a vote', async () => {
    const d = await client.detail('/gegenstand/XXVIII/I/251');
    expect(d.content.phase?.length).toBeGreaterThan(2);
    expect(d.content.vote?.text).toMatch(/Dafür/);
    expect(d.content.status?.description).toBeTruthy();
  });

  it('a committee names its chairs', async () => {
    const d = await client.detail('/ausschuss/XXVIII/A-FI/1/00921');
    expect(d.content.names?.some((n) => /Obmann|Obfrau/.test(n.funktext ?? ''))).toBe(true);
  });

  it('a person page has mandates and a biography', async () => {
    const d = personSchema.parse(await client.person(91034));
    expect(d.content.biografie?.mandatefunktionen?.mandate?.length).toBeGreaterThan(0);
    expect(d.content.biografie?.kurzbiografie?.gebtext).toMatch(/1971/);
  });

  it('a session lists agenda items and speeches with their own segments', () => {
    expect(session.progress.length).toBeGreaterThan(5);
    const speeches = session.progress.flatMap((p) => p.speeches ?? []);
    expect(speeches.length).toBeGreaterThan(20);
    expect(speeches[0]!.protocol?.data.links[0]?.documents?.some((d) => d.type === 'HTML')).toBe(true);
  });

  it('a finished session carries decisions, press releases and agenda documents', () => {
    expect(session.resolutions.length).toBeGreaterThan(2);
    expect(session.resolutions[0]!.materials?.some((m) => (m.stages?.length ?? 0) > 0)).toBe(true);
    expect(session.correspondence.length).toBeGreaterThan(0);
    expect(session.agenda.length).toBeGreaterThan(0);
  });

  it('a speech segment is HTML with a speaker marker', async () => {
    const html = await client.document('/dokument/XXVIII/NRSITZ/30/A_-_11_12_46_00801352.html');
    expect(html).toContain('class="randnummer"');
    expect(html).toContain('Kickl');
  });
});
