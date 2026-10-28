import * as cheerio from 'cheerio';

export interface Speech {
  /** As printed in the protocol, e.g. "Herbert Kickl (FPÖ)"; null when the segment carries no marker. */
  speaker: string | null;
  /** Start / end time of the speech ("11.12"), if the protocol states them. */
  start: string | null;
  end: string | null;
  paragraphs: string[];
}

/**
 * Turn a protocol segment (one speech, HTML) into text paragraphs.
 *
 * The segment marks the speaker in `<p class="randnummer" title="Name (Party)">`, the start and end time in
 * `p._RB` / `p._RE`, and interjections ("Beifall bei der FPÖ", "Abg. X: Na bravo!") in `<i>`.
 * Pass `interjections: false` to cut the interjections out; the speech then reads continuously.
 */
export function parseSpeechHtml(html: string, opts: { interjections?: boolean } = {}): Speech {
  const $ = cheerio.load(html);
  const speaker = $('p.randnummer').first().attr('title')?.trim() || null;
  const start = $('p._RB').first().text().trim() || null;
  const end = $('p._RE').first().text().trim() || null;
  $('p.randnummer, p._RB, p._RE, script, style').remove();
  if (opts.interjections === false) $('i').remove();

  const paragraphs: string[] = [];
  $('body')
    .find('p, h1, h2, h3, li')
    .each((_, el) => {
      const text = $(el).text().replace(/\s+/g, ' ').trim();
      if (text) paragraphs.push(text);
    });
  return { speaker, start, end, paragraphs };
}

export interface Window {
  text: string;
  /** Characters of the full text before this window. */
  from: number;
  /** Characters of the full text up to the end of this window. */
  to: number;
  total: number;
}

/**
 * Cut `maxChars` characters starting at `offset`, preferring to stop at a paragraph break so a quote
 * never ends mid-sentence when it can be avoided.
 */
export function windowText(text: string, offset: number, maxChars: number): Window {
  const total = text.length;
  const from = Math.min(offset, total);
  let to = Math.min(from + maxChars, total);
  if (to < total) {
    const breakAt = text.lastIndexOf('\n\n', to);
    if (breakAt > from + maxChars * 0.5) to = breakAt;
  }
  return { text: text.slice(from, to).trim(), from, to, total };
}
