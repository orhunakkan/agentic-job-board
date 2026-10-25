import { describe, expect, it } from 'vitest';
import { canonicalizeJobUrl } from '../../../src/domain/linkedin-url.ts';

const CANONICAL = { jobId: '4473592349', url: 'https://www.linkedin.com/jobs/view/4473592349/' };

describe('canonicalizeJobUrl', () => {
  it('FR-04: turns an alert-email "comm" link into the job ID and canonical URL', () => {
    expect(canonicalizeJobUrl('https://www.linkedin.com/comm/jobs/view/4473592349/')).toEqual(CANONICAL);
  });

  it('FR-04: accepts a link without "comm"', () => {
    expect(canonicalizeJobUrl('https://www.linkedin.com/jobs/view/4473592349/')).toEqual(CANONICAL);
  });

  it.each([
    'https://www.linkedin.com/comm/jobs/view/4473592349',
    'https://www.linkedin.com/jobs/view/4473592349',
    'https://www.linkedin.com/comm/jobs/view/4473592349/?trackingId=abc',
    'https://linkedin.com/comm/jobs/view/4473592349/',
    'https://WWW.LinkedIn.com/comm/jobs/view/4473592349/',
    '  https://www.linkedin.com/comm/jobs/view/4473592349/  ',
  ])('FR-04: accepts the variant %s', (link) => {
    expect(canonicalizeJobUrl(link)).toEqual(CANONICAL);
  });

  it.each([
    'https://www.linkedin.com/jobs/search/?currentJobId=4473592349&keywords=sdet&f_TPR=r86400',
    'https://www.linkedin.com/jobs/collections/recommended/?currentJobId=4473592349',
    'https://www.linkedin.com/jobs/?currentJobId=4473592349',
    'https://www.linkedin.com/jobs/view/4473592349/?alternateChannel=search&trackingId=x',
  ])('FR-18: accepts a search-page link that names the open job: %s', (link) => {
    expect(canonicalizeJobUrl(link)).toEqual(CANONICAL);
  });

  it.each([
    ['currentJobId off the jobs pages', 'https://www.linkedin.com/feed/?currentJobId=4473592349'],
    ['a non-numeric currentJobId', 'https://www.linkedin.com/jobs/search/?currentJobId=abc'],
    ['an empty currentJobId', 'https://www.linkedin.com/jobs/search/?currentJobId='],
    ['currentJobId on a look-alike path', 'https://www.linkedin.com/jobsearch/?currentJobId=4473592349'],
    ['currentJobId on another domain', 'https://example.com/jobs/search/?currentJobId=4473592349'],
  ])('FR-18: returns null for %s', (_case, link) => {
    expect(canonicalizeJobUrl(link)).toBeNull();
  });

  it('NFR-07: drops every query parameter, including one-time tokens', () => {
    const link =
      'https://www.linkedin.com/comm/jobs/view/4473592349/?trackingId=h%2FW&refId=sp&midToken=AQER&midSig=2-e7&otpToken=OTJh%3D%3D#top';

    const result = canonicalizeJobUrl(link);

    expect(result).toEqual(CANONICAL);
    expect(result?.url).not.toMatch(/[?#]|Token|tracking/);
  });

  it.each([
    ['a job search link without an open job', 'https://www.linkedin.com/comm/jobs/search-results/?keywords=qa'],
    ['the job alerts page', 'https://www.linkedin.com/comm/jobs/alerts'],
    ['a help article', 'https://www.linkedin.com/help/linkedin/answer/4788'],
    ['a profile link', 'https://www.linkedin.com/in/someone/'],
    ['a job path with a non-numeric ID', 'https://www.linkedin.com/jobs/view/abc/'],
    ['a job path with an extra segment', 'https://www.linkedin.com/jobs/view/4473592349/apply/'],
    ['a job path with no ID', 'https://www.linkedin.com/jobs/view/'],
    ['an implausibly long ID', `https://www.linkedin.com/jobs/view/${'1'.repeat(21)}/`],
  ])('FR-04: returns null for a LinkedIn link that is not a job: %s', (_case, link) => {
    expect(canonicalizeJobUrl(link)).toBeNull();
  });

  it.each([
    ['another domain', 'https://example.com/jobs/view/4473592349/'],
    ['a look-alike domain', 'https://www.linkedin.com.evil.example/jobs/view/4473592349/'],
    ['a LinkedIn suffix on another domain', 'https://notlinkedin.com/jobs/view/4473592349/'],
    ['plain http', 'http://www.linkedin.com/jobs/view/4473592349/'],
    ['a non-default port', 'https://www.linkedin.com:8443/jobs/view/4473592349/'],
    ['embedded credentials', 'https://user:pass@www.linkedin.com/jobs/view/4473592349/'],
    ['a javascript: URL', 'javascript:alert(1)//www.linkedin.com/jobs/view/4473592349/'],
    ['text that is not a URL', 'not a url'],
    ['an empty string', ''],
  ])('FR-04: returns null for a non-LinkedIn link: %s', (_case, link) => {
    expect(canonicalizeJobUrl(link)).toBeNull();
  });
});
