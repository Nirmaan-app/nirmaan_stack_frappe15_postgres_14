import { useFrappeGetCall } from "frappe-react-sdk";

import { SnagFieldValuesResponse } from "../types";
import { SNAG_ENDPOINTS } from "../config/snagTable.config";

const EMPTY: SnagFieldValuesResponse = { areas: [], categories: [] };

export interface UseSnagFieldValuesResult {
  areas: string[];
  categories: string[];
  isLoading: boolean;
}

/**
 * The distinct Area / Category values THIS PROJECT'S snags already use, offered as
 * `<datalist>` SUGGESTIONS in the Add and Edit dialogs.
 *
 * ⚠️ SUGGESTIONS, NOT A CLOSED SET. Both fields stay FREE TEXT — ADR-0016 and its
 * 2026-08-21 amendment. A closed dropdown would reverse that ADR outright and make
 * the first snag in a new area unenterable. Never turn this into a `Select`.
 *
 * `enabled` exists so the call is made when a dialog OPENS, not on every table
 * render: the swrKey is `null` until then, which skips the fetch entirely (the 3rd
 * argument is the swrKey, NOT an options object — see the app-wide gotcha).
 *
 * A failure is SILENT on purpose: with no suggestions the input is still a perfectly
 * usable free-text box, so an error banner would report a degraded convenience as a
 * broken form.
 */
export function useSnagFieldValues(
  projectId: string | undefined,
  enabled: boolean
): UseSnagFieldValuesResult {
  const active = !!projectId && enabled;
  const { data, isLoading } = useFrappeGetCall<{
    message: SnagFieldValuesResponse;
  }>(
    SNAG_ENDPOINTS.snagFieldValues,
    { project: projectId },
    active ? undefined : null
  );

  const raw = data?.message;
  return {
    areas: raw?.areas ?? EMPTY.areas,
    categories: raw?.categories ?? EMPTY.categories,
    isLoading: active && isLoading,
  };
}
