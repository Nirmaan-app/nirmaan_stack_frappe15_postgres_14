import { useFrappeGetCall, useFrappeGetDocList, useFrappePostCall, useSWRConfig } from "frappe-react-sdk";
import { useCallback, useMemo } from "react";

import type {
  EstimatesOverview, EstimatesReply, ReattachReply, SaveEstimateReply, SettleOlderReply, SheetRow, SheetRowsReply,
} from "@/utils/estimations/estimateTypes";

const API = "nirmaan_stack.api.estimations";

/** The project's Selected BOQs with per-sheet estimate counts. */
export function useEstimatesOverview(projectId: string) {
  const { data, error, isLoading, mutate } = useFrappeGetCall<{ message: EstimatesOverview }>(
    `${API}.boq_view.get_estimates_overview`, { project: projectId }, projectId ? undefined : null,
  );
  return { overview: data?.message, error, isLoading, mutate };
}

/** A sheet's committed rows, through the existing read the BOQ sheet viewer uses (unchanged, read-only). */
export function useSheetRows(boq: string | null, sheetName: string | null) {
  const ready = !!boq && sheetName != null;
  const { data, error, isLoading } = useFrappeGetCall<{ message: SheetRowsReply }>(
    "nirmaan_stack.api.boq.wizard.pricing.get_priced_rows",
    { boq_name: boq, sheet_name: sheetName },
    ready ? undefined : null,
  );
  const rows: SheetRow[] = useMemo(() => data?.message?.rows ?? [], [data]);
  return { rows, error, isLoading };
}

/** Cache key of a BOQ's estimates: one per BOQ + sheet (`*` = every sheet), all sharing the BOQ prefix. */
const estimatesKey = (boq: string, sheetName?: string | null) => `estimates:${boq}:${sheetName ?? "*"}`;

/** The estimates of a BOQ, or of one of its sheets (`sheetName` given, verbatim). */
export function useEstimates(boq: string | null, sheetName?: string | null) {
  const params: Record<string, string> = boq ? { boq } : {};
  if (boq && sheetName != null) params.sheet_name = sheetName;
  const { data, error, isLoading } = useFrappeGetCall<{ message: EstimatesReply }>(
    `${API}.boq_view.get_estimates`, params, boq ? estimatesKey(boq, sheetName) : null,
  );
  const reply: EstimatesReply = useMemo(() => data?.message ?? { current: [], older: [] }, [data]);
  return { estimates: reply, error, isLoading };
}

/**
 * Refetches every cached estimates read of a BOQ (each sheet, and the all-sheets one Estimate Items uses), so a
 * save, Re-attach or Remove on one view is never shown stale on another. Uses frappe-react-sdk's own SWR cache:
 * `useSWRConfig` from "swr" would be a different cache and refresh nothing.
 */
export function useRefreshEstimates() {
  const { mutate } = useSWRConfig();
  return useCallback(
    (boq: string) => mutate((key: unknown) => typeof key === "string" && key.startsWith(`estimates:${boq}:`)),
    [mutate],
  );
}

/** Save one line's estimate, and re-attach estimates after a re-commit. */
export function useEstimateWrites() {
  const save = useFrappePostCall<{ message: SaveEstimateReply }>(`${API}.estimate_writes.save_estimate`);
  const reattach = useFrappePostCall<{ message: ReattachReply }>(`${API}.estimate_writes.reattach_estimates`);
  const settleOld = useFrappePostCall<{ message: SettleOlderReply }>(`${API}.estimate_writes.settle_older`);
  return {
    saveEstimate: save.call, saving: save.loading,
    reattachEstimates: reattach.call,
    settleOlder: settleOld.call,
    olderBusy: reattach.loading || settleOld.loading,
  };
}

interface ItemDoc { name: string; item_name: string; unit_name: string | null; category: string | null }
interface CategoryDoc { name: string; work_package: string | null }
interface CategoryMakeDoc { category: string; make: string }

/** The Items list, categories and makes per category, for the estimate form. Fetched only while `enabled`. */
export function useItemsCatalog(enabled: boolean) {
  const items = useFrappeGetDocList<ItemDoc>(
    "Items", { fields: ["name", "item_name", "unit_name", "category"], limit: 0, orderBy: { field: "item_name", order: "asc" } },
    enabled ? "estimates-items-catalog" : null,
  );
  const categories = useFrappeGetDocList<CategoryDoc>(
    "Category", { fields: ["name", "work_package"], limit: 0, orderBy: { field: "name", order: "asc" } },
    enabled ? "estimates-categories" : null,
  );
  const makes = useFrappeGetDocList<CategoryMakeDoc>(
    "Category Makelist", { fields: ["category", "make"], limit: 0 },
    enabled ? "estimates-category-makes" : null,
  );
  const makesByCategory = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const m of makes.data ?? []) {
      if (!m.make) continue;
      const list = (out[m.category] ??= []);
      if (!list.includes(m.make)) list.push(m.make);
    }
    Object.values(out).forEach((list) => list.sort());
    return out;
  }, [makes.data]);
  return {
    items: items.data ?? [],
    categories: categories.data ?? [],
    makesByCategory,
    isLoading: items.isLoading || categories.isLoading || makes.isLoading,
  };
}
