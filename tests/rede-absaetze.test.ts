import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { createServer } from '../src/server.js';
import { formatRede, parseParagraphRange, type Located } from '../src/tools/rede.js';
import { clientWith, fixtureText, json } from './helpers.js';

const located: Located = { speaker: 'Kickl Herbert', time: '11:12', top: 'TOP 1', htmlPath: '/dokument/a.html', autorisiert: null };
const base = { located, sessionTitle: '30. Sitzung', protocolNote: null, interjections: true, offset: 0, maxChars: 30_000 };
const html = [
  '<p class="randnummer" title="A"></p>',
  ...Array.from({ length: 10 }, (_, i) => `<p>Absatz Nummer ${i + 1} <i>(Beifall)</i></p>`),
].join('');

describe('parseParagraphRange', () => {
  it.each([
    ['7', { from: 7, to: 7 }],
    ['5-9', { from: 5, to: 9 }],
    [' 5 – 9 ', { from: 5, to: 9 }],
    ['3-3', { from: 3, to: 3 }],
  ])('%j', (input, expected) => expect(parseParagraphRange(input)).toEqual(expected));

  it.each(['', '0', '9-5', 'a', '5-', '-5', '5-9-12', '1,2', '12345', '5..9', '0-3'])('rejects %j', (bad) => {
    expect(parseParagraphRange(bad)).toBeNull();
  });
});

describe('numbered paragraphs', () => {
  it('numbers every paragraph and says how many there are', () => {
    const text = formatRede({ ...base, html });
    expect(text).toContain('10 Absätze, in eckigen Klammern nummeriert (mit Zwischenrufen gezählt)');
    expect(text).toContain('[1] Absatz Nummer 1 (Beifall)\n\n[2] Absatz Nummer 2');
    expect(text).toContain('[10] Absatz Nummer 10');
  });

  it('says which variant the numbers belong to', () => {
    expect(formatRede({ ...base, html, interjections: false })).toContain('(ohne Zwischenrufe gezählt)');
  });

  it('returns only the asked paragraphs, still with their original numbers', () => {
    const text = formatRede({ ...base, html, paragraphs: { from: 4, to: 6 } });
    expect(text).toContain('Absätze 4–6 von 10');
    expect(text).toContain('[4] Absatz Nummer 4');
    expect(text).toContain('[6] Absatz Nummer 6');
    expect(text).not.toContain('[3]');
    expect(text).not.toContain('[7]');
    expect(text).toContain('[Ende der Rede');
  });

  it('shortens a range that reaches past the end', () => {
    const text = formatRede({ ...base, html, paragraphs: { from: 9, to: 99 } });
    expect(text).toContain('Absätze 9–10 von 10');
    expect(text).toContain('[10] Absatz Nummer 10');
  });

  it('explains a range that starts after the end', () => {
    const text = formatRede({ ...base, html, paragraphs: { from: 50, to: 52 } });
    expect(text).toContain('Die Rede hat nur 10 Absätze');
    expect(text).not.toContain('[1]');
  });

  it('a speech without text has no numbering line', () => {
    const text = formatRede({ ...base, html: '<p class="randnummer" title="A"></p>' });
    expect(text).not.toContain('nummeriert');
    expect(text).toContain('(Der Redebeitrag enthält keinen Text.)');
  });

  it('numbers stay the same when the text is read in several windows', () => {
    const first = formatRede({ ...base, html, maxChars: 1_000 });
    expect(first).toContain('[1] ');
    const longHtml = Array.from({ length: 30 }, (_, i) => `<p>${`Wort${i} `.repeat(60).trim()}</p>`).join('');
    const a = formatRede({ ...base, html: longHtml, maxChars: 2_000 });
    const next = Number(/offset=(\d+)\]/.exec(a)![1]);
    const b = formatRede({ ...base, html: longHtml, maxChars: 2_000, offset: next });
    const last = [...a.matchAll(/\[(\d+)\] /g)].map((m) => Number(m[1])).pop()!;
    const firstOfB = [...b.matchAll(/\[(\d+)\] /g)].map((m) => Number(m[1]))[0]!;
    expect(firstOfB).toBeGreaterThanOrEqual(last);
    expect(firstOfB).toBeLessThanOrEqual(last + 1);
  });
});

describe('parl_rede over MCP', () => {
  async function connect() {
    const { client: parl } = clientWith((url) => {
      if (url.endsWith('/gegenstand/XXVIII/NRSITZ/30?json=TRUE')) return json(fixtureText('session-nr-xxviii-30.json'));
      if (url.endsWith('/dokument/XXVIII/NRSITZ/30/A_-_11_12_46_00801352.html'))
        return new Response(fixtureText('speech-kickl-A_-_11_12_46_00801352.html'));
      throw new Error(`unexpected ${url}`);
    });
    const server = createServer(parl);
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(b);
    const client = new Client({ name: 'test', version: '0' });
    await client.connect(a);
    return client;
  }
  const call = async (client: Client, args: Record<string, unknown>) => {
    const res = await client.callTool({ name: 'parl_rede', arguments: { gp: 28, nummer: 30, rede: 801352, ...args } });
    return { text: (res.content as Array<{ text: string }>)[0]!.text, isError: Boolean(res.isError) };
  };

  it('delivers a real speech with numbered paragraphs and a selectable range', async () => {
    const client = await connect();
    const all = await call(client, {});
    expect(all.isError).toBe(false);
    expect(all.text).toMatch(/\d+ Absätze, in eckigen Klammern nummeriert/);
    expect(all.text).toContain('[1] ');
    const some = await call(client, { absaetze: '2-3' });
    expect(some.text).toContain('Absätze 2–3 von');
    expect(some.text).toContain('[2] ');
    expect(some.text).toContain('[3] ');
    expect(some.text).not.toContain('[4] ');
    expect(some.text.length).toBeLessThan(all.text.length);
  });

  it('rejects a malformed range with an explanation, without calling the Parliament again for it', async () => {
    const client = await connect();
    const res = await call(client, { absaetze: '9-2' });
    expect(res.isError).toBe(true);
    expect(res.text).toContain('Ungültiger Absatzbereich');
  });
});
