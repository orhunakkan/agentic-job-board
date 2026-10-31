import { describe, expect, it } from 'vitest';
import { decodeEntities, htmlToText, oneLine } from '../../../src/sources/html-text.ts';

describe('HTML to text', () => {
  it('FR-17: keeps paragraphs and list items, drops every tag', () => {
    const html =
      '<div><h2>About</h2><p>We plan <b>everything</b>.</p><ul><li>Load planning</li><li>Driver check-ins</li></ul></div>';

    expect(htmlToText(html)).toBe('About\n\nWe plan everything.\n\n• Load planning\n• Driver check-ins');
  });

  it('FR-17: reads HTML that was escaped once more (Greenhouse)', () => {
    expect(htmlToText('&lt;p&gt;Senior &amp;amp; remote&lt;/p&gt;&lt;p&gt;Second&lt;/p&gt;')).toBe(
      'Senior & remote\n\nSecond',
    );
  });

  it('NFR-07: never keeps a script, style or any markup, even escaped', () => {
    const text = htmlToText('<p>Hi</p><script>alert(1)</script><style>p{}</style><img src=x onerror=alert(1)>');

    expect(text).toBe('Hi');
  });

  it('NFR-07: text that only looks like a tag stays text, for the page to escape', () => {
    expect(htmlToText('Use &lt;b&gt; tags <i>wisely</i>')).toBe('Use <b> tags wisely');
  });

  it('FR-17: decodes named, decimal and hex entities and leaves unknown ones', () => {
    expect(decodeEntities('&quot;Nurse&quot; &#8211; &#x2F;remote&#x2f; &rsquo;s &bogus; &#0;')).toBe(
      '"Nurse" – /remote/ ’s &bogus; ',
    );
  });

  it('FR-17: collapses whitespace, including non-breaking spaces, and blank-line runs', () => {
    expect(htmlToText('  a   b \r\n\r\n\r\n\r\n c\t ')).toBe('a b\n\nc');
  });

  it('FR-17: cuts long text with an ellipsis', () => {
    expect(htmlToText('abcdefghij', 5)).toBe('abcd…');
    expect(htmlToText('abcde', 5)).toBe('abcde');
  });

  it('FR-17: gives null when nothing is left', () => {
    expect(htmlToText('<p> </p><br>')).toBeNull();
  });

  it('FR-15: oneLine joins every line into one', () => {
    expect(oneLine('<b>Senior</b>\n<i>Dispatcher</i>')).toBe('Senior Dispatcher');
  });
});
