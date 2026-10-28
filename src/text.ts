const ENTITIES: Record<string, string> = {
  nbsp: ' ', amp: '&', quot: '"', apos: "'", lt: '<', gt: '>',
  auml: 'ä', ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü', szlig: 'ß',
  eacute: 'é', egrave: 'è', agrave: 'à', ccedil: 'ç', ntilde: 'ñ',
  ndash: '–', mdash: '—', hellip: '…', bdquo: '„', ldquo: '“', rdquo: '”', sbquo: '‚', lsquo: '‘', rsquo: '’',
  laquo: '«', raquo: '»', sect: '§', euro: '€', shy: '',
};

/** Decode numeric and the common named HTML entities in one pass, so "&amp;lt;" correctly stays "&lt;". */
function decodeEntities(s: string): string {
  return s.replace(/&(?:#(\d{1,6})|#[xX]([0-9a-fA-F]{1,6})|([A-Za-z]{2,8}));/g, (whole, dec: string | undefined, hex: string | undefined, name: string | undefined) => {
    if (name !== undefined) return ENTITIES[name] ?? whole;
    const code = dec !== undefined ? Number(dec) : parseInt(hex ?? '', 16);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });
}

/**
 * The API embeds HTML in text fields, e.g. "Arpa Claudia, Mag.<sup>a</sup>" for the title "Mag.a", and
 * HTML entities ("Erm&auml;chtigung"). Keep the text of such markup, drop the tags, decode the entities.
 */
export function cleanText(s: string): string {
  return decodeEntities(s.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
}

/** Fold case and strip diacritics so "Ostermayer", "OSTERMAYER" and "Östermayer" all match. */
export function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/ß/g, 'ss')
    .toLowerCase()
    .trim();
}

/** Shorten long text at a word boundary for tool output. */
export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  return cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 40)).trimEnd() + ' […]';
}
