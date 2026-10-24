import { adzunaSearch, type AdzunaKey } from './adzuna.ts';
import { ashbyBoard, greenhouseBoard, leverBoard, smartRecruitersBoard, workableBoard } from './company-boards.ts';
import type { FeedRequest } from './feed.ts';
import { hackerNewsThreads } from './hacker-news.ts';
import { himalayasSearch, jobicyFeed, remoteOkFeed } from './remote-boards.ts';
import type { SourcesConfig } from './source-config.ts';

// Every request one run of scripts/fetch-sources.ts starts with (FR-15), from data/sources.json. Each URL comes
// from a fixed template on a fixed host; the config only fills in company names and keywords, encoded.

export function planFeeds(config: SourcesConfig, adzunaKey: AdzunaKey | null): FeedRequest[] {
  const { companies, feeds, keywords } = config;
  return [
    ...companies.greenhouse.map(greenhouseBoard),
    ...companies.lever.map(leverBoard),
    ...companies.ashby.map(ashbyBoard),
    ...companies.smartrecruiters.map((slug) => smartRecruitersBoard(slug)),
    ...companies.workable.map(workableBoard),
    ...(feeds.remoteok ? [remoteOkFeed()] : []),
    ...(feeds.himalayas ? keywords.map(himalayasSearch) : []),
    ...(feeds.jobicy ? [jobicyFeed()] : []),
    ...(feeds.hackernews ? [hackerNewsThreads(keywords)] : []),
    ...(feeds.adzuna && adzunaKey !== null ? keywords.map((keyword) => adzunaSearch(keyword, adzunaKey)) : []),
  ];
}
