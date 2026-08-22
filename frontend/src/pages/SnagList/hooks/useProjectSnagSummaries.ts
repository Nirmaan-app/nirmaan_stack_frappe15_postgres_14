import { useFrappeGetCall } from "frappe-react-sdk";

import { SNAG_ENDPOINTS } from "../config/snagTable.config";
import { ProjectSnagSummary } from "../types";

export interface UseProjectSnagSummariesResult {
  summaries: ProjectSnagSummary[];
  isLoading: boolean;
  error: Error | null;
  mutate: () => void;
}

const EMPTY: ProjectSnagSummary[] = [];

/**
 * Every project that has snags, with its status tally — the whole `/snag-list` grid
 * in ONE call (see `api/snags/project_list.py`).
 *
 * Deliberately NOT `useSnagStats` in a loop: that endpoint is project-scoped, so N
 * projects would be N round trips. The server does one GROUP BY instead.
 *
 * The call is read-guarded server-side and REFUSES Accountant / Accountant Lead. A
 * refusal surfaces as `error` — callers render it, they do not dress it up as an
 * empty grid (which would read as "no snags anywhere").
 */
export function useProjectSnagSummaries(): UseProjectSnagSummariesResult {
  const { data, isLoading, error, mutate } = useFrappeGetCall<{
    message: ProjectSnagSummary[];
  }>(SNAG_ENDPOINTS.projectSummaries, undefined, undefined, {
    revalidateOnFocus: false,
  });

  const raw = data?.message;

  return {
    summaries: Array.isArray(raw) ? raw : EMPTY,
    isLoading,
    // frappe-js-sdk ships its OWN `Error` shape — normalised through `unknown` so
    // callers get one type. Same cast `useSnagStats` makes.
    error: (error as unknown as Error) ?? null,
    mutate,
  };
}
