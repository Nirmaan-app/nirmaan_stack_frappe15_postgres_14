import { useFrappeGetCall } from "frappe-react-sdk";

import { SnagStatsSummary, SnagStatus } from "../types";
import { SNAG_ENDPOINTS } from "../config/snagTable.config";

const EMPTY_STATS: SnagStatsSummary = {
  total: 0,
  by_status: {
    Pending: 0,
    WIP: 0,
    Completed: 0,
    "Not Applicable": 0,
  },
  by_batch: {},
};

export interface UseSnagStatsResult {
  stats: SnagStatsSummary;
  isLoading: boolean;
  error: Error | null;
  mutate: () => void;
}

/**
 * Project-scoped Total / Pending / WIP / Completed tally, PLUS the same tally split
 * per batch (`by_batch`) that feeds the batch tab strip.
 *
 * NOTE there is deliberately NO Risk Level in this feature (plan § 2 + § 8.4) —
 * the source file's hand-maintained High/Medium/Low tally is not replaced, so do
 * not add one here.
 */
export function useSnagStats(projectId?: string): UseSnagStatsResult {
  const { data, isLoading, error, mutate } = useFrappeGetCall<{
    message: SnagStatsSummary;
  }>(
    SNAG_ENDPOINTS.stats,
    { project: projectId },
    // 3rd arg is the swrKey, NOT options: `undefined` = fetch, `null` = skip.
    projectId ? undefined : null
  );

  const raw = data?.message;
  const stats: SnagStatsSummary = raw
    ? {
        total: raw.total ?? 0,
        by_status: { ...EMPTY_STATS.by_status, ...(raw.by_status ?? {}) } as Record<
          SnagStatus,
          number
        >,
        // Passed through as sent. A batch ABSENT from the map has no snags, which is
        // what its tab must read as -- do not seed a key per known batch here: the
        // batch list is not this hook's to know, and a seeded 0 would be
        // indistinguishable from a stats call that failed.
        by_batch: raw.by_batch ?? {},
      }
    : EMPTY_STATS;

  return {
    stats,
    isLoading: !!projectId && isLoading,
    // frappe-js-sdk ships its OWN `Error` shape (message/httpStatus/exception),
    // structurally distinct from the DOM `Error`. Normalised through `unknown`
    // so callers get one type — same cast `useServerDataTable` makes.
    error: (error as unknown as Error) ?? null,
    mutate,
  };
}
