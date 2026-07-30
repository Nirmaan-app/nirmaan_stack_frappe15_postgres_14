// Rate Master (RM-2) discipline registry.
//
// Registry-shaped like pricingWorkbooks.ts so more disciplines drop in as data.
// Today Electrical only. Each discipline lists its category ids (the config
// endpoint is keyed by (discipline, category_id), so the id is needed to fetch
// the config); the human label shown in the picker is enriched from the config's
// own `category_display` when it loads, with this `label` as the fallback.

export interface RateMasterCategoryEntry {
  category_id: string;
  /** Fallback label until the config's category_display loads. */
  label: string;
}

export interface RateMasterDisciplineEntry {
  discipline: string;
  label: string;
  categories: RateMasterCategoryEntry[];
}

export const RATE_MASTER_ROUTE = "/rate-master";

export const RATE_MASTER_DISCIPLINES: readonly RateMasterDisciplineEntry[] = [
  {
    discipline: "Electrical",
    label: "Electrical",
    categories: [{ category_id: "wiring_cabling", label: "Wiring, Cabling & Termination" }],
  },
];
