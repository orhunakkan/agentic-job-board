import { z } from 'zod';

// The last line scripts/search-linkedin.ts prints (FR-18, FR-19): what /find-jobs reads back for its summary
// (agent/find-jobs.md step 5a). The contract tests check the example there against this schema.

const Count = z.number().int().nonnegative();

export const SearchLinkedInSummarySchema = z.strictObject({
  /** The run the jobs went to; null in a dry run, which sends nothing. */
  runId: z.number().int().positive().nullable(),
  /** Searches run, and the search pages opened for them. */
  searches: Count,
  pages: Count,
  /** Job cards read from the search pages, before filtering. */
  cards: Count,
  /** Cards dropped because the title has an excluded keyword. */
  excluded: Count,
  /** Jobs dropped because they were posted before the search's window. */
  older: Count,
  /** Jobs kept, once each across all searches. */
  matched: Count,
  /** Job pages read (for jobs new to the board, or for --backfill). */
  detailsRead: Count,
  /** Jobs left out because LinkedIn says they no longer accept applications. */
  closed: Count,
  new: Count,
  seenAgain: Count,
  repeated: Count,
  /** One line per search or job page that could not be read, e.g. "SDET: no job cards on page 1". */
  failures: z.array(z.string()),
});

export type SearchLinkedInSummary = z.infer<typeof SearchLinkedInSummarySchema>;
