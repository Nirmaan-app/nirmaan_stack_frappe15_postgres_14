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
    // EA-1: all eleven Electrical categories. The label is a fallback; the picker shows each config's
    // own category_display once it loads. (The category set is registry-driven, not config-read.)
    categories: [
      { category_id: "wiring_cabling", label: "Wiring, Cabling & Termination" },
      { category_id: "earthing", label: "Earthing" },
      { category_id: "conduit_piping", label: "Electrical Conduit" },
      { category_id: "junction_box_raceway", label: "Junction Box for Raceway" },
      { category_id: "cabletray_raceway", label: "CableTray & Raceway" },
      { category_id: "popup_boxes", label: "Pop-up / Floor Boxes" },
      { category_id: "industrial_sockets", label: "Industrial Socket" },
      { category_id: "switches_sockets", label: "Switches and Sockets" },
      { category_id: "db_switchgear", label: "DB and Switchgear" },
      { category_id: "miscellaneous", label: "Miscellaneous" },
      { category_id: "lighting_mgmt_system", label: "Lighting Management System" },
      // EA-DIFF: point_wiring is DATA-ONLY (empty pipelines) -- renders coming-soon exactly like LMS.
      // Its config banks the 29-Jul EA-4 oracle (1869/735/2604) in its notes.
      { category_id: "point_wiring", label: "Point Wiring" },
      // EA-4b: switches_point is the 6-line switch/socket/plate/box assembly (distinct from
      // switches_sockets); goldens sp1 2320/470/1600. A new category needs its registry line.
      { category_id: "switches_point", label: "Switches Point" },
    ],
  },
];
