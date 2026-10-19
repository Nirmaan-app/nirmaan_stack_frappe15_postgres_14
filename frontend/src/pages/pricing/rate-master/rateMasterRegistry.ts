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
  /**
   * SLICE 2 (2026-09-22, owner P-d, ruling R1): `false` marks a MESSAGE-ONLY category that holds NO
   * items. It is still FETCHED (its config carries `helper_message` / `pending_label`, which the rate
   * helper panel, the pricing grid and the calculator read) but it is NOT listed on the Rate Master
   * page -- `rateMasterPageEntry` filters it out there. Absent => today: an item category.
   */
  holds_items?: false;
}

export interface RateMasterDisciplineEntry {
  discipline: string;
  label: string;
  categories: RateMasterCategoryEntry[];
}

export const RATE_MASTER_ROUTE = "/rate-master";

/**
 * The discipline entry AS THE RATE MASTER PAGE READS IT: item categories only (`holds_items !== false`).
 * PURE. Returns the SAME object when nothing is filtered, so an entry with no message-only categories
 * (every Electrical entry) is reference-identical and the page is byte-unchanged for it.
 */
export function rateMasterPageEntry<T extends RateMasterDisciplineEntry | undefined>(entry: T): T {
  if (!entry) return entry;
  const kept = entry.categories.filter((c) => c.holds_items !== false);
  return (kept.length === entry.categories.length ? entry : { ...entry, categories: kept }) as T;
}

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
      // SLICE 12b(A): the numbers the pricing rules read -- a discount, a markup, a wastage, a BCS
      // ratio, an installation share or a flat amount. It DOES hold items, so `holds_items` is
      // deliberately omitted and the category appears on the Rate Master page (acceptance 1 + 2).
      // Its config carries NO pipelines and NO attribute definitions, so `config_is_eligible` is false
      // and it can never price a BoQ row or enter the extraction population (acceptance 14).
      // ⚠️ ELECTRICAL ONLY IN THIS SLICE -- HVAC's inputs arrive in 12c, born connected to Insulation's
      // pricing rule. Nothing inert is created for HVAC, and no empty category (acceptance 3).
      { category_id: "electrical_pricing_inputs", label: "Pricing Inputs" },
      // RETIRED 2026-08-08: `switches_point` (the EA-4b 6-line switch/socket/plate/box assembly) is
      // gone from this list ON PURPOSE. It priced rows `switches_sockets` already covers, and a reader
      // could reasonably take it for the switch-and-socket category. Its config is superseded
      // (`retired_category_ids` in the E-ALL asset), and THIS LIST IS WHAT THE PICKER READS -- leaving
      // the line behind would offer a category whose config no longer resolves.
    ],
  },
  // HVAC (slice 1b, 2026-09-21): its OWN asset file (`rate_master_hvac_all_vN.json`) with its OWN
  // version number -- each discipline is versioned, minted, merged and loaded on its own (owner ruling
  // R-a as amended 2026-09-21; the HVAC series starts at v1). Categories are added here as they are
  // built. `hvac_adp` is DATA-ONLY this slice (items + attributes, `pipelines: {}`), so it is NOT
  // eligible for pricing or extraction -- the Rate Master page shows it, no pricing screen does.
  // ⚠️ AFTER Electrical, deliberately: `RATE_MASTER_DISCIPLINES[0]` is read as the default discipline
  // by the Rate Master page and the calculator tests, and must stay Electrical.
  {
    discipline: "HVAC",
    label: "HVAC",
    categories: [
      { category_id: "hvac_adp", label: "ADP (Air Distribution Products)" },
      // SLICE 2 (2026-09-22, owner P-a / P-b / P-d): the four VENDOR-QUOTE categories -- always priced
      // from a vendor quotation, so their configs are MESSAGE-ONLY (no items, no attributes, no
      // pipelines; `helper_message` "Take Vendor Quotation" + `pending_label`). `holds_items: false`
      // keeps them OFF the Rate Master page; they are still fetched for the helper and the calculator.
      // The ids are the HVAC classifier's exact ids (categories_hvac.json).
      { category_id: "hvac_ahu", label: "AHU", holds_items: false },
      { category_id: "hvac_dx_unit", label: "DX Unit", holds_items: false },
      { category_id: "hvac_panels", label: "Panels", holds_items: false },
      { category_id: "hvac_pumps", label: "Pumps", holds_items: false },
      // SLICE 3 (2026-09-22, owner Q-a / Q-b): the two ALIAS categories -- their configs carry `alias_of`
      // and resolve to Electrical's wiring / tray categories at lookup (stored ONCE, never copied). They
      // own no items (`holds_items: false`): listed in the calculator, fetched for the helper, and kept
      // OFF the Rate Master page exactly like the vendor-quote entries above.
      { category_id: "hvac_cables", label: "Cables", holds_items: false },
      { category_id: "hvac_raceway", label: "Raceway", holds_items: false },
      // SLICE 12a (2026-09-26, owner I-1): Insulation -- the CATALOGUE and the derived-cost MECHANISM.
      // It DOES hold items (224: the sheet's 156 plus the 68 24G twins of owner ruling I-10), so
      // `holds_items` is deliberately OMITTED and the category appears on the Rate Master page.
      // Its config carries NO pipelines this slice, so it is not eligible for pricing or extraction --
      // pricing, extraction and the panel are 12b -- and no BoQ screen changes.
      { category_id: "hvac_insulation", label: "Insulation" },
      // SLICE 12e-1 (2026-10-09, owner "(b) accept it"): the Piping CATALOGUE -- 40 per-metre items from the
      // workbook's Piping sheet (copper / MS / PVC / CPVC) with a DATA-ONLY config (pipelines {}), so it holds
      // items (listed here, beside Insulation -- the two piped catalogues together, Pricing Inputs last) and
      // is never priced: a Piping BoQ row and the calculator show the "coming soon" card until 12e-2.
      { category_id: "hvac_piping", label: "Piping" },
      // SLICE 12c (2026-10-03): HVAC's Pricing Inputs -- the seven numbers Insulation's cladding rule
      // reads. BORN CONNECTED, which is the whole point of minting them with the rule in one asset: an
      // input no pipeline reads shows "not used" and a zero-SKU impact panel. It DOES hold items, so
      // `holds_items` is omitted and the category appears on the Rate Master page, exactly like
      // Electrical's. Its config carries no pipelines and no attribute definitions, so it can never
      // price a BoQ row.
      { category_id: "hvac_pricing_inputs", label: "Pricing Inputs" },
    ],
  },
];
