import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// PLAN.md §8.2: fixtures copied from real pages or emails are sanitized before they are committed. Phase 11 keeps
// two kinds: saved copies of LinkedIn's search page and job pane (tests/fixtures/linkedin/), and the jobs the old
// email ingest stored for the three sanitized alert emails (tests/fixtures/email-years.json).

const linkedinDir = new URL('../fixtures/linkedin/', import.meta.url);
const pages = readdirSync(linkedinDir).filter((name) => name.endsWith('.html'));
const emailYears = readFileSync(new URL('../fixtures/email-years.json', import.meta.url), 'utf8');

// The made-up values the saved pages use where LinkedIn puts tracking values, and the fixed values LinkedIn uses.
const PLACEHOLDER_VALUES = /^(?:[A-F]{4}(?:%3D%3D)?|x|1|search|NON_CHARGEABLE_CHANNEL|d?_?flagship3_search_srp_jobs)$/;

describe('the saved LinkedIn pages are sanitized', () => {
  it('NFR-08: a search page, a job page, a closed job page and a no-results page are kept', () => {
    expect(pages.sort()).toEqual(['job-page-closed.html', 'job-page.html', 'no-results-page.html', 'search-page.html']);
  });

  describe.each(pages)('%s', (name) => {
    const html = readFileSync(new URL(name, linkedinDir), 'utf8');

    it('NFR-08: says it is a sanitized copy with made-up jobs', () => {
      expect(html).toMatch(/sanitized copy/i);
      expect(html).toMatch(/made up/i);
    });

    it('NFR-08: keeps no script, image, logo or tracking pixel', () => {
      expect(html).not.toMatch(/<script|<img|<iframe|licdn\.com|data:image/i);
    });

    it('NFR-08: links to no member profile, and holds no email address', () => {
      expect(html).not.toMatch(/linkedin\.com\/in\/|href="\/in\//);
      expect(html.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) ?? []).toEqual([]);
    });

    it('NFR-08: every value in a link’s query string is a made-up placeholder', () => {
      const values = [...html.matchAll(/href="[^"?]*\?([^"]*)"/g)].flatMap(([, query = '']) =>
        query.split('&amp;').map((pair) => pair.split('=')[1] ?? ''),
      );

      expect(values.filter((value) => !PLACEHOLDER_VALUES.test(value))).toEqual([]);
    });
  });
});

describe('the email-years fixture is sanitized', () => {
  it('NFR-08: no URL keeps a query string, and no tracking or one-time token survives', () => {
    const urls = emailYears.match(/https?:\/\/[^\s"]+/g) ?? [];

    expect(urls.length).toBeGreaterThan(0);
    expect(urls.filter((url) => /[?#]/.test(url))).toEqual([]);
    expect(emailYears).not.toMatch(/otpToken|midToken|midSig|trackingId|refId|trkEmail|lipi=|savedSearchId|loid=/);
  });

  it('NFR-08: the only email addresses are LinkedIn senders', () => {
    const addresses = emailYears.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) ?? [];

    expect(addresses.filter((address) => !/^(?:jobalerts-noreply|jobs-noreply)@linkedin\.com$/.test(address))).toEqual(
      [],
    );
  });
});
