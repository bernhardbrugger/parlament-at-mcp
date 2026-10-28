/**
 * The API embeds HTML in text fields, e.g. "Arpa Claudia, Mag.<sup>a</sup>" for the title "Mag.a".
 * Keep the text of such markup and drop the tags.
 */
export function cleanText(s: string): string {
  return s
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&') // last, so "&amp;lt;" stays "&lt;"
    .replace(/\s+/g, ' ')
    .trim();
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
