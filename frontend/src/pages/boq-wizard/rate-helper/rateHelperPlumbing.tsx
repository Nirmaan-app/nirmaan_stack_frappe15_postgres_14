/**
 * Calculator slice 2 (2026-09-09) -- THE RATE-HELPER DATA PLUMBING, EXPORTED ONCE.
 *
 * Until this slice the three pieces below lived privately in `SheetPricingPage.tsx`: the registry-
 * derived list of (discipline, category) config targets, the hook-safe N-fetch child that loads ONE
 * category's config and reports it up, and the items fetch with its discipline hardcoded. The
 * Calculator tab on `/electrical-pricing` mounts the SAME helper the BoQ panel does, so it needs the
 * SAME configs and the SAME items -- and a copied target list that later diverged would price a
 * category on one surface and not the other. So the pieces moved here, ONE definition each, and the
 * BoQ page imports them back. This is a MOVE, not a redesign: the method names, the arguments, the
 * SWR keys and the accumulate-once state logic are byte-for-byte what the page held.
 *
 * ⚠️ Nothing here reads a BoQ, a run or a row. Everything is keyed on the registry and the discipline.
 */
import { useCallback, useEffect, useState } from "react";
import { useFrappeGetCall } from "frappe-react-sdk";
import type { RateCategoryConfig, RateMasterItem } from "@/pages/pricing/rate-master/rateMasterTypes";
import { RATE_MASTER_DISCIPLINES } from "@/pages/pricing/rate-master/rateMasterRegistry";

/** EA-2: the rate-master category configs the pricing helper may resolve, one per registry category
 * (all Electrical). Registry-driven: a new category flows through with no code change here. */
export const RATE_MASTER_CONFIG_TARGETS: Array<{ discipline: string; categoryId: string }> =
  RATE_MASTER_DISCIPLINES.flatMap((d) =>
    d.categories.map((c) => ({ discipline: d.discipline, categoryId: c.category_id })),
  );

/** EA-2: fetch ONE category's rate config and report it up. Renders no DOM; one hook per instance --
 * the same hook-safe N-fetch shape as the BoQ page's EngineCatalogFetcher. */
export function RateConfigFetcher({
  discipline,
  categoryId,
  onLoaded,
}: {
  discipline: string;
  categoryId: string;
  onLoaded: (categoryId: string, config: RateCategoryConfig | null) => void;
}) {
  const { data } = useFrappeGetCall<{ message: { config: RateCategoryConfig | null } }>(
    "nirmaan_stack.api.boq.rate_master.get_rate_category_config",
    { discipline, category_id: categoryId },
    `boq-rm-config::${discipline}::${categoryId}`,
  );
  const config = data?.message?.config;
  useEffect(() => {
    if (config !== undefined) onLoaded(categoryId, config ?? null);
  }, [config, categoryId, onLoaded]);
  return null;
}

/**
 * The N-category config map, accumulated from the `RateConfigFetcher` children. Load-once per
 * category (a settled Map -> a stable helper): a config already in the map is never replaced, so the
 * map's identity changes exactly N times and the memoised helper rebuilds exactly N times. Returns the
 * map and the reference-stable `onLoaded` the fetchers take.
 */
export function useConfigsByCategory(): {
  configsByCategory: Map<string, RateCategoryConfig>;
  onConfigLoaded: (categoryId: string, config: RateCategoryConfig | null) => void;
} {
  const [configsByCategory, setConfigsByCategory] = useState<Map<string, RateCategoryConfig>>(
    () => new Map(),
  );
  const onConfigLoaded = useCallback(
    (categoryId: string, config: RateCategoryConfig | null) => {
      if (!config) return;
      setConfigsByCategory((prev) => {
        if (prev.has(categoryId)) return prev;
        const next = new Map(prev);
        next.set(categoryId, config);
        return next;
      });
    },
    [],
  );
  return { configsByCategory, onConfigLoaded };
}

/**
 * The live rate-master items for a discipline (once per page, SWR-cached), read through
 * `get_rate_master_items` so `brand` arrives projected into `attributes` exactly as every matcher
 * expects. `enabled` false => a null SWR key (no fetch), the BoQ page's kill-switch shape.
 *
 * The discipline defaults to "Electrical" -- the value the BoQ page hardcoded -- and the SWR key for
 * that default is the page's original `boq-rm-items-electrical`, so the move changes no cache entry.
 */
export function useRateMasterItems(enabled: boolean, discipline: string = "Electrical") {
  return useFrappeGetCall<{ message: { items: RateMasterItem[] } }>(
    "nirmaan_stack.api.boq.rate_master.get_rate_master_items",
    { discipline },
    enabled ? `boq-rm-items-${discipline.toLowerCase()}` : null,
  );
}
