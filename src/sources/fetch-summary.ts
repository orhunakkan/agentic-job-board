import { z } from 'zod';

// The last line scripts/fetch-sources.ts prints (FR-15): what /find-jobs reads back for its summary
// (agent/find-jobs.md step 5b). The contract tests check the example there against this schema.

const Count = z.number().int().nonnegative();

export const FetchSourcesSummarySchema = z.strictObject({
  /** The run the listings went to; null in a dry run, which sends nothing. */
  runId: z.number().int().positive().nullable(),
  /** Requests made, follow-up pages included. */
  feeds: Count,
  /** Jobs the feeds listed, before filtering. */
  fetched: Count,
  /** Jobs kept by the keywords and locations, once each. */
  matched: Count,
  new: Count,
  seenAgain: Count,
  repeated: Count,
  /** One line per feed that failed, e.g. "Lever examplelabs: HTTP 404". */
  failures: z.array(z.string()),
});

export type FetchSourcesSummary = z.infer<typeof FetchSourcesSummarySchema>;
