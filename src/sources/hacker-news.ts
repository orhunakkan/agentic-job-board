import { z } from 'zod';
import { FeedFormatError, readJobs, type FeedRequest } from './feed.ts';
import { containsAny } from './filter.ts';
import { htmlToText, oneLine } from './html-text.ts';

// Hacker News "Ask HN: Who is hiring?" (PLAN.md Phase 10, DEC-035), through the free Algolia HN API. Two requests:
// the newest monthly thread, then its top-level posts. Posts are free text; by convention the first line reads
// "Company | Role | Location | …", which is all this reads into fields. The whole post becomes the description.

const ALGOLIA = 'https://hn.algolia.com/api/v1';
const THREAD_TITLE = /^Ask HN: Who is hiring\?/i;

const Story = z.object({ objectID: z.string(), title: z.string() });

export function hackerNewsThreads(roleKeywords: readonly string[]): FeedRequest {
  const name = 'Hacker News';
  return {
    source: 'hackernews',
    name,
    url: `${ALGOLIA}/search_by_date?tags=story,author_whoishiring&hitsPerPage=10`,
    read: (body) => {
      const stories = z.object({ hits: z.array(Story) }).safeParse(body);
      if (!stories.success) throw new FeedFormatError(`${name}: unexpected answer`);
      const thread = stories.data.hits.find((story) => THREAD_TITLE.test(story.title));
      if (thread === undefined) throw new FeedFormatError(`${name}: no "Who is hiring?" thread found`);
      return { jobs: 0, listings: [], followUps: [hackerNewsPosts(thread.objectID, roleKeywords)] };
    },
  };
}

const Post = z.object({
  objectID: z.string(),
  parent_id: z.union([z.number(), z.string()]),
  comment_text: z.string(),
  created_at: z.string().nullish(),
});

export function hackerNewsPosts(storyId: string, roleKeywords: readonly string[]): FeedRequest {
  const name = 'Hacker News';
  return {
    source: 'hackernews',
    name,
    url: `${ALGOLIA}/search?tags=comment,story_${encodeURIComponent(storyId)}&hitsPerPage=1000`,
    read: (body) => ({
      ...readJobs(
        name,
        body,
        z.object({ hits: z.array(z.unknown()) }).transform((answer) => answer.hits),
        Post,
        (post) => {
          // Replies to posts are not job posts.
          if (String(post.parent_id) !== storyId) return null;
          const header = readHeader(post.comment_text, roleKeywords);
          if (header === null) return null;
          return {
            source: 'hackernews',
            sourceJobId: post.objectID,
            ...header,
            url: `https://news.ycombinator.com/item?id=${post.objectID}`,
            postedAt: post.created_at ?? null,
            salary: null,
            description: htmlToText(post.comment_text),
          };
        },
      ),
      followUps: [],
    }),
  };
}

// A part that names a place or a way of working: "REMOTE", "Hybrid", "New York, NY", "SF Bay Area", "US only".
const PLACE_WORDS = /\b(?:remote|on-?site|in-?office|hybrid|anywhere|worldwide|united states|europe|americas)\b/i;
const PLACE_CODES = /(?:,\s*[A-Z]{2}\b|\b(?:NYC|SF|LA|US|USA|U\.S\.|UK|EU)\b)/;

function isPlace(part: string): boolean {
  return PLACE_WORDS.test(part) || PLACE_CODES.test(part);
}

/**
 * Company, title and location from "Company | Role | Location | …". The title is the part that names one of the
 * owner's roles, or else the second part; a post with no "|" in its first line isn't a job post.
 */
export function readHeader(
  commentHtml: string,
  roleKeywords: readonly string[],
): { company: string; title: string; location: string } | null {
  const firstLine = oneLine(commentHtml.split(/<p>/i)[0] ?? '');
  const parts = firstLine
    .split('|')
    .map((part) => part.trim())
    .filter((part) => part !== '');
  const [company, ...rest] = parts;
  if (company === undefined || rest.length === 0) return null;

  const title = rest.find((part) => containsAny(part, roleKeywords)) ?? rest[0] ?? '';
  const location = rest.filter((part) => part !== title && isPlace(part)).join(' · ');
  return { company, title, location };
}
