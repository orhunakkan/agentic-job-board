// Job descriptions arrive as HTML (Greenhouse even escapes it once more). The board shows them as plain text, so
// markup never reaches a page; the page escapes the text again like any other value (NFR-07).

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  hellip: '…',
  bull: '•',
  middot: '·',
  copy: '©',
  reg: '®',
  trade: '™',
  euro: '€',
  pound: '£',
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, name: string) => {
    if (name.startsWith('#')) {
      const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    }
    return NAMED_ENTITIES[name.toLowerCase()] ?? entity;
  });
}

// A list item starts its own line ("• "), so only its start is marked; marking its end too would leave blank lines.
const BLOCK_END = /<\/(?:p|div|h[1-6]|ul|ol|tr|table|section|blockquote)>|<br\s*\/?>/gi;

/** Plain text with its paragraphs, at most `max` characters (cut with "…"), or null when nothing is left. */
export function htmlToText(html: string, max = Number.POSITIVE_INFINITY): string | null {
  // Escaped once more (Greenhouse): "&lt;p&gt;" with no real tag in it.
  const markup = /&lt;\/?[a-z]/i.test(html) && !/<\/?[a-z]/i.test(html) ? decodeEntities(html) : html;

  const text = decodeEntities(
    markup
      .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, '')
      .replace(/<li\b[^>]*>/gi, '\n• ')
      .replace(BLOCK_END, '\n')
      .replace(/<p\b[^>]*>/gi, '\n\n') // Hacker News starts paragraphs with <p> and never closes them
      .replace(/<[^>]*>/g, ''),
  )
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[\t \u00a0]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (text === '') return null;
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/** One line of text: tags dropped, entities decoded, whitespace collapsed. */
export function oneLine(html: string): string {
  return (htmlToText(html) ?? '').replace(/\s+/g, ' ').trim();
}
