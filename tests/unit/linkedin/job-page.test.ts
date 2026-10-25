import { describe, expect, it } from 'vitest';
import {
  linkedInListing,
  LinkedInPageFormatError,
  RawJobPageSchema,
  RawSearchCardSchema,
  relativeTimeToIso,
  salaryFrom,
  toJobDetails,
  toSearchCard,
  type RawJobPage,
  type RawSearchCard,
} from '../../../src/linkedin/job-page.ts';
import { DESCRIPTION_MAX } from '../../../src/schemas/api.ts';

const NOW = '2026-10-24T12:00:00.000Z';

// Shaped like what scripts/search-linkedin.ts copies out of the live page (checked 2026-10-24), made-up companies.
const CARD: RawSearchCard = {
  jobId: '4483361330',
  href: '/jobs/view/4483361330/?eBP=NON_CHARGEABLE_CHANNEL&refId=abc&trackingId=DTEN%3D%3D&trk=flagship3_search_srp_jobs',
  title: 'Senior SDET (Playwright)',
  company: '\n  Example Health\n',
  metadata: ['United States (Remote)', '$140K/yr - $170K/yr · 401(k) benefit'],
  listedDate: '2026-10-24',
  listedText: '41 minutes ago',
  footer: ['41 minutes ago Within the past 24 hours', 'Easy Apply'],
};

const PAGE: RawJobPage = {
  href: '/jobs/view/4483361330/?alternateChannel=search&trackingId=x',
  title: 'Senior SDET (Playwright)',
  company: 'Example Health',
  tertiary: ['United States', 'Reposted 8 minutes ago', '1 applicant', 'Promoted by hirer'],
  pills: ['$140K/yr - $170K/yr', 'Remote', 'Full-time'],
  descriptionHtml:
    '<h2>About the job</h2><p>We build <strong>health</strong> software &amp; tools.</p><ul><li>Playwright</li><li>TypeScript</li></ul>',
  closed: false,
};

describe('relativeTimeToIso', () => {
  it.each([
    ['41 minutes ago', '2026-10-24T11:19:00.000Z'],
    ['1 hour ago', '2026-10-24T11:00:00.000Z'],
    ['5 hours ago', '2026-10-24T07:00:00.000Z'],
    ['3 days ago', '2026-10-21T12:00:00.000Z'],
    ['1 week ago', '2026-10-17T12:00:00.000Z'],
    ['2 weeks ago', '2026-10-10T12:00:00.000Z'],
    ['1 month ago', '2026-09-24T12:00:00.000Z'],
    ['30+ days ago', '2026-09-24T12:00:00.000Z'],
    ['Reposted 8 minutes ago', '2026-10-24T11:52:00.000Z'],
    ['Posted 2 Hours Ago', '2026-10-24T10:00:00.000Z'],
    ['10 seconds ago', '2026-10-24T11:59:50.000Z'],
    ['1 year ago', '2025-10-24T12:00:00.000Z'],
    ['Just now', NOW],
    ['moments ago', NOW],
  ])('FR-18: %j was at %s', (text, iso) => {
    expect(relativeTimeToIso(text, NOW)).toBe(iso);
  });

  it.each(['1 applicant', 'Promoted by hirer', '', 'Over 100 applicants', 'in 3 days'])(
    'FR-18: %j is no time',
    (text) => {
      expect(relativeTimeToIso(text, NOW)).toBeNull();
    },
  );
});

describe('salaryFrom', () => {
  it.each([
    [['$200K/yr - $250K/yr · 401(k) benefit'], '$200K/yr - $250K/yr'],
    [['Medical, 401(k), +1 benefit', '$55/hr - $65/hr'], '$55/hr - $65/hr'],
    [['€60K/yr'], '€60K/yr'],
    [['£ 45,000/yr'], '£ 45,000/yr'],
  ])('FR-19: finds the amount in %j', (lines, salary) => {
    expect(salaryFrom(lines)).toBe(salary);
  });

  it.each([[[]], [['1 benefit']], [['Medical, 401(k), Vision']]])('FR-19: no amount in %j is null', (lines) => {
    expect(salaryFrom(lines)).toBeNull();
  });
});

describe('toSearchCard', () => {
  it('FR-18: reads the job ID, title, company, location, listed time, salary and Easy Apply', () => {
    expect(toSearchCard(CARD, NOW)).toEqual({
      jobId: '4483361330',
      title: 'Senior SDET (Playwright)',
      company: 'Example Health',
      location: 'United States (Remote)',
      listedAt: '2026-10-24T11:19:00.000Z',
      listedDayOnly: false,
      salary: '$140K/yr - $170K/yr',
      easyApply: true,
    });
  });

  it('FR-18: takes the job ID from the link when the card has none, and never keeps the tracking query', () => {
    const card = toSearchCard({ ...CARD, jobId: null }, NOW);

    expect(card?.jobId).toBe('4483361330');
    expect(JSON.stringify(card)).not.toMatch(/tracking|refId|eBP/);
  });

  it('FR-18: falls back to the card’s date when its text names no time, and to null without either', () => {
    expect(toSearchCard({ ...CARD, listedText: 'Promoted' }, NOW)).toMatchObject({
      listedAt: '2026-10-24T00:00:00.000Z',
      listedDayOnly: true,
    });
    expect(toSearchCard({ ...CARD, listedText: null, listedDate: 'yesterday' }, NOW)).toMatchObject({
      listedAt: null,
      listedDayOnly: false,
    });
  });

  it('FR-18: a card without a location, salary or Easy Apply keeps them empty', () => {
    expect(toSearchCard({ ...CARD, metadata: [], footer: ['Viewed', 'Promoted'] }, NOW)).toMatchObject({
      location: '',
      salary: null,
      easyApply: false,
    });
  });

  it.each([
    ['no job ID or link', { jobId: null, href: null }],
    ['a link to something else', { jobId: null, href: '/company/example/' }],
    ['a job ID that is not a number', { jobId: 'abc', href: null }],
    ['no title (not filled in yet)', { title: '  ' }],
    ['no company', { company: '' }],
  ])('FR-18: a card with %s is unreadable (null)', (_case, change) => {
    expect(toSearchCard({ ...CARD, ...change }, NOW)).toBeNull();
  });

  it('NFR-09: cuts long text to what the API takes and keeps it on one line', () => {
    const card = toSearchCard({ ...CARD, title: `Senior\nSDET ${'x'.repeat(400)}` }, NOW);

    expect(card?.title).toHaveLength(300);
    expect(card?.title).toMatch(/^Senior SDET x+…$/);
  });

  it('NFR-09: the raw card schema refuses a shape it does not know', () => {
    expect(RawSearchCardSchema.safeParse({ ...CARD, extra: 1 }).success).toBe(false);
    expect(RawSearchCardSchema.safeParse({ ...CARD, metadata: 'United States' }).success).toBe(false);
  });
});

describe('toJobDetails', () => {
  it('FR-19: reads the description, salary, workplace and posted time from the job page', () => {
    expect(toJobDetails(PAGE, NOW)).toEqual({
      jobId: '4483361330',
      title: 'Senior SDET (Playwright)',
      company: 'Example Health',
      location: 'United States',
      postedAt: '2026-10-24T11:52:00.000Z',
      salary: '$140K/yr - $170K/yr',
      workplace: 'remote',
      description: 'We build health software & tools.\n\n• Playwright\n• TypeScript',
      closed: false,
    });
  });

  it.each([
    ['Hybrid', 'hybrid'],
    ['On-site', 'on-site'],
    ['Onsite', 'on-site'],
  ])('FR-19: the pill %j is workplace %s', (pill, workplace) => {
    expect(toJobDetails({ ...PAGE, pills: ['Full-time', pill] }, NOW).workplace).toBe(workplace);
  });

  it('FR-19: a page without pills, posted time or description leaves them empty', () => {
    expect(toJobDetails({ ...PAGE, pills: [], tertiary: ['Austin, TX'], descriptionHtml: null }, NOW)).toMatchObject({
      location: 'Austin, TX',
      postedAt: null,
      salary: null,
      workplace: null,
      description: null,
    });
    expect(toJobDetails({ ...PAGE, descriptionHtml: '<h2>About the job</h2>' }, NOW).description).toBeNull();
  });

  it('FR-19: a job that no longer takes applications says so', () => {
    expect(toJobDetails({ ...PAGE, closed: true }, NOW).closed).toBe(true);
  });

  it('FR-19: cuts the description to DESCRIPTION_MAX characters', () => {
    const description = toJobDetails({ ...PAGE, descriptionHtml: `<p>${'word '.repeat(5000)}</p>` }, NOW).description;

    expect(description).toHaveLength(DESCRIPTION_MAX);
    expect(description?.endsWith('…')).toBe(true);
  });

  it('NFR-07: drops scripts and markup from the description, keeping text that only looks like a tag', () => {
    const html = '<p>Use &lt;T&gt; generics</p><script>alert(1)</script><img src=x onerror=alert(1)>';

    expect(toJobDetails({ ...PAGE, descriptionHtml: html }, NOW).description).toBe('Use <T> generics');
  });

  it.each([
    ['no title', { title: '' }],
    ['no link', { href: null }],
    ['a link to another page', { href: '/feed/' }],
  ])('FR-19: a page with %s is a format error', (_case, change) => {
    expect(() => toJobDetails({ ...PAGE, ...change }, NOW)).toThrow(LinkedInPageFormatError);
  });

  it('NFR-09: the raw page schema refuses a shape it does not know', () => {
    expect(RawJobPageSchema.safeParse({ ...PAGE, closed: 'no' }).success).toBe(false);
  });
});

describe('linkedInListing', () => {
  const card = toSearchCard(CARD, NOW);
  const details = toJobDetails(PAGE, NOW);
  if (card === null) throw new Error('the test card must be readable');

  it('FR-18, FR-19: a new job is the card plus its page, linked canonically, with the search that found it', () => {
    expect(linkedInListing(card, details, 'QA family')).toEqual({
      source: 'linkedin',
      sourceJobId: '4483361330',
      title: 'Senior SDET (Playwright)',
      company: 'Example Health',
      location: 'United States (Remote)',
      url: 'https://www.linkedin.com/jobs/view/4483361330/',
      postedAt: '2026-10-24T11:52:00.000Z',
      salary: '$140K/yr - $170K/yr',
      description: 'We build health software & tools.\n\n• Playwright\n• TypeScript',
      workplace: 'remote',
      easyApply: true,
      searchName: 'QA family',
    });
  });

  it('FR-18: a job the board already has is sent from its card alone', () => {
    expect(linkedInListing(card, null, null)).toEqual({
      source: 'linkedin',
      sourceJobId: '4483361330',
      title: 'Senior SDET (Playwright)',
      company: 'Example Health',
      location: 'United States (Remote)',
      url: 'https://www.linkedin.com/jobs/view/4483361330/',
      postedAt: '2026-10-24T11:19:00.000Z',
      salary: '$140K/yr - $170K/yr',
      description: null,
      workplace: null,
      easyApply: true,
    });
  });

  it('FR-19: takes the page’s location and company when the card has none', () => {
    const bare = { ...card, location: '' };

    expect(linkedInListing(bare, { ...details, company: '' }, null)).toMatchObject({
      location: 'United States',
      company: 'Example Health',
    });
  });
});
