import { useFrappeGetCall } from "frappe-react-sdk";

/**
 * One count spec for the batch `get_counts` endpoint.
 * - `group_field` present  -> result is a `{ value: count }` map (GROUP BY).
 * - otherwise              -> result is a single `number`.
 */
export interface CountSpec {
  key: string;
  doctype: string;
  filters?: (string | number | (string | number)[])[][] | Record<string, unknown>;
  group_field?: string;
}

export type CountsResult = Record<string, number | Record<string, number>>;

/**
 * Batch counts in ONE round-trip via `nirmaan_stack.api.counts.get_counts` — replaces the
 * per-metric / per-status `useFrappeGetDocCount` fan-out (dashboards, summary cards, status
 * tabs). Pass a stable `specs` array; each spec's `key` indexes its result. The backend
 * uses `frappe.db.count` / `frappe.get_all`, so permission scoping and `is not set`
 * semantics are identical to the individual calls this replaces.
 *
 * `swrKey` defaults to a content hash of `specs` so identical panels share one fetch; pass
 * an explicit key to share across components or to keep it stable across renders.
 *
 * Freshness: the returned `mutate()` gives an IMMEDIATE refetch (call it after a create /
 * approve / pay / delete so the badge updates at once). We deliberately keep SWR's default
 * `revalidateOnFocus` (true) rather than disabling it — the `useFrappeGetDocCount` calls this
 * replaces relied on it (the app sets no global swrConfig), so counts also refresh on window
 * focus exactly as before. Pass `options` to override per call site if ever needed.
 */
export function useCounts(
  specs: CountSpec[],
  swrKey?: string,
  options?: Record<string, unknown>
) {
  return useFrappeGetCall<{ message: CountsResult }>(
    "nirmaan_stack.api.counts.get_counts",
    { specs: JSON.stringify(specs) },
    swrKey ?? `counts:${JSON.stringify(specs)}`,
    options
  );
}
