import { describe, expect, it } from 'vitest';
import { FeedFormatError } from '../../../src/sources/feed.ts';
import { hackerNewsPosts, hackerNewsThreads, readHeader } from '../../../src/sources/hacker-news.ts';

// Answers shaped like the Algolia HN API's (checked 2026-10-24), with made-up companies and posts.

const ROLES = ['nurse', 'dispatcher', 'patient care', 'charge nurse'];

describe('Hacker News "Who is hiring?"', () => {
  it('FR-15: finds the newest hiring thread, skipping "Who wants to be hired?"', () => {
    const request = hackerNewsThreads(ROLES);
    const result = request.read({
      hits: [
        { objectID: '49922568', title: 'Ask HN: Who wants to be hired? (October 2026)' },
        { objectID: '49922569', title: 'Ask HN: Who is hiring? (October 2026)' },
        { objectID: '49522897', title: 'Ask HN: Who is hiring? (September 2026)' },
      ],
    });

    expect(request.url).toBe(
      'https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&hitsPerPage=10',
    );
    expect(result.listings).toEqual([]);
    expect(result.followUps.map((followUp) => followUp.url)).toEqual([
      'https://hn.algolia.com/api/v1/search?tags=comment,story_49922569&hitsPerPage=1000',
    ]);
  });

  it('FR-15: no hiring thread is a feed failure', () => {
    expect(() => hackerNewsThreads(ROLES).read({ hits: [] })).toThrow('no "Who is hiring?" thread found');
    expect(() => hackerNewsThreads(ROLES).read({ nope: true })).toThrow(FeedFormatError);
  });

  it('FR-15: reads top-level posts only, and only those shaped like job posts', () => {
    const { jobs, listings } = hackerNewsPosts('49922569', ROLES).read({
      hits: [
        {
          objectID: '50012248',
          parent_id: 49_922_569,
          story_id: 49_922_569,
          author: 'someone',
          created_at: '2026-10-08T21:04:09Z',
          comment_text:
            'Example Exchange | Engineering Manager (NYC) · Fleet Dispatcher, Operations (U.S. Remote) | Full-Time<p>We match buyers &amp; sellers.<p>Apply at jobs@example.com',
        },
        {
          objectID: '50012300',
          parent_id: 50_012_248,
          created_at: '2026-10-09T10:00:00Z',
          comment_text: 'Is this | still open?',
        },
        {
          objectID: '50012400',
          parent_id: 49_922_569,
          created_at: '2026-10-09T11:00:00Z',
          comment_text: 'Great thread, thanks!',
        },
      ],
    });

    expect(jobs).toBe(3);
    expect(listings).toEqual([
      {
        source: 'hackernews',
        sourceJobId: '50012248',
        title: 'Engineering Manager (NYC) · Fleet Dispatcher, Operations (U.S. Remote)',
        company: 'Example Exchange',
        location: '',
        url: 'https://news.ycombinator.com/item?id=50012248',
        postedAt: '2026-10-08T21:04:09.000Z',
        salary: null,
        description:
          'Example Exchange | Engineering Manager (NYC) · Fleet Dispatcher, Operations (U.S. Remote) | Full-Time\n\nWe match buyers & sellers.\n\nApply at jobs@example.com',
      },
    ]);
  });
});

describe('readHeader', () => {
  it.each([
    [
      'Example Labs | Senior Nurse Educator | Remote (US) | Full-time | $150k',
      { company: 'Example Labs', title: 'Senior Nurse Educator', location: 'Remote (US)' },
    ],
    [
      'Sample Co | <a href="https://sample.example">https://sample.example</a> | Founding Engineer | New York, NY | ONSITE',
      { company: 'Sample Co', title: 'https://sample.example', location: 'New York, NY · ONSITE' },
    ],
    [
      'Acme | Patient Care Lead, Dispatcher | SF Bay Area or REMOTE | Series B',
      { company: 'Acme', title: 'Patient Care Lead, Dispatcher', location: 'SF Bay Area or REMOTE' },
    ],
  ])('FR-15: reads %j', (header, expected) => {
    expect(readHeader(`${header}<p>Body`, ROLES)).toEqual(expected);
  });

  it('FR-15: a first line without "|" is not a job post', () => {
    expect(readHeader('We are hiring nurses!<p>Details', ROLES)).toBeNull();
    expect(readHeader('Only a company |', ROLES)).toBeNull();
  });
});
