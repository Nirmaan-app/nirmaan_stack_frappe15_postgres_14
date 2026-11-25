/**
 * VAV-2b2 (R16) -- A ROW FILED UNDER MISC OR SENSORS THAT THE VAV HELPER PRICES.
 *
 * Owner 2026-11-21 12:33 (verbatim): "for VAV we borrow items from sensor and misc, so VAV helper should run over those categories also.
 * any other category if we need we will build as exceptions."; 12:34 "agree on all 3" -- only on sheets with VAV rows, only rows that name
 * a VAV item, the row stays filed where it is and carries a note; 12:36 "a" the note's wording. An EXCEPTION to "the user's category
 * decides" (block 83), VAV Box only, no toggle.
 *
 * WHICH rows: decided ONCE, on the server (services/boq_rate_master/vav_claims.py, the Python twin of this file's neighbours'
 * `vavSeparateRow` tests, pinned equal by the vav2b2Claims parity tests). The run's result row carries `claimed_from` / `claimed_item` /
 * `claimed_kind`; this module only READS that. A row with no such result (never suggested) is "coming soon" exactly as before.
 * HOW it prices (owner rulings, R3 / R17): the kind's `prices` -- a full-rate block the helper adds (a separate BACnet controller / DDC
 * panel row: per unit by the formula, the VAVs pre-filled = the sheet's VAVs / the row's quantity), or ONE item (the DP sensor as the
 * Duct Static Pressure Sensor, the VAV integrator, VAV installation, a piece) -- the model's own answer for that item when it gave one
 * (its attributes), else the item alone. PURE.
 */
import type { RateCategoryConfig } from "../../pricing/rate-master/rateMasterTypes";
import type { ExtractedListItem, ItemListPricingSpec } from "./itemListPricing";
import type { ItemBlockView, ItemListView } from "./pricingSheetHelper";

/** `list_spec.pricing.claims_filed` (validated by config_validation._validate_claims_filed; VAV Box only). */
export interface ClaimsFiledSpec {
  /** the categories claimed from -> their label in the note ("Misc", "Sensors & Controls") */
  categories: Record<string, string>;
  /** "This row is filed under {category}. It is priced here because it matches a VAV item ({item}). The classification may be wrong." */
  note: string;
  kinds: Array<{ id: string; item: string; share?: string; own_row_extra?: string; existing_boxes?: boolean; words?: string; not_words?: string;
    /** how the claimed row is priced: a full-rate block the helper adds, or one item (own family, or a section's family) */
    prices?: { whole?: string; family?: string; section?: string };
    /** a neutral line the claimed row also carries (installation rows: the control-cabling check, owner 2026-11-18 22:40) */
    line?: string }>;
}

/** The claim a run result carries (absent on every other row). */
export interface RowClaim { from: string; item: string; kind: string }

type ConfigMap = ReadonlyMap<string, RateCategoryConfig> | undefined;
type Spec = ItemListPricingSpec & { claims_filed?: ClaimsFiledSpec };
const specOf = (c: RateCategoryConfig | null | undefined): Spec | null =>
  ((c as unknown as { list_spec?: { pricing?: Spec } } | null)?.list_spec?.pricing as Spec | undefined) ?? null;

/** PURE. The config that prices a claimed row: the run's category, when its config declares `claims_filed` naming the row's FILED category
 *  and the run's claim says the row came from there. Null for every other row (it keeps its own category's config). */
export function claimedConfigOf(claim: RowClaim | undefined, runCategory: string | undefined, filedCategory: string | null,
  configs: ConfigMap): RateCategoryConfig | null {
  if (!claim || !runCategory || !filedCategory || claim.from !== filedCategory || !configs) return null;
  const cfg = configs.get(runCategory) ?? null;
  const cf = specOf(cfg)?.claims_filed;
  return cf && cf.categories[filedCategory] !== undefined ? cfg : null;
}

/** VAV-2c1 (R4, owner 2026-11-22 10:51 "all a", 4.1). PURE. A claimed row's view: each item the pricer did not add or change says "matched by
 *  the helper" (the helper's rule chose it), its borrowed items too. */
export function matchedByHelper(view: ItemListView): ItemListView {
  const mark = (b: ItemBlockView): ItemBlockView => (b.source === "model" ? { ...b, matchedByHelper: true } : b);
  const own = (v: ItemListView): ItemListView => ({ ...v, items: v.items.map(mark) });
  return { ...own(view), ...(view.sections ? { sections: { ...view.sections, independent: view.sections.independent.map((s) => ({ ...s, view: own(s.view) })) } } : {}) };
}

/** PURE. The notes a claimed row carries: the R16 note (owner 12:36 "a"), then its kind's own line if it has one (13:40, QR-K3 B2). */
export function claimNotesOf(spec: Spec, claim: RowClaim): string[] {
  const cf = spec.claims_filed;
  if (!cf) return [];
  const line = cf.kinds.find((x) => x.id === claim.kind)?.line;
  return [cf.note.replace("{category}", cf.categories[claim.from] ?? claim.from).replace("{item}", claim.item), ...(line ? [line] : [])];
}

/** PURE. The claimed row's items, by its kind's `prices`: a full-rate block -> no item (the helper adds the block: `helperWhole`); one
 *  item -> the model's own item of that family if it answered one (its attributes kept), else that item alone, quantity 1 per row unit. */
export function claimedItemsOf(spec: Spec, claim: RowClaim, items: readonly ExtractedListItem[] | undefined,
  familyAttrOf: (section: string | undefined) => string): { items: ExtractedListItem[]; helperWhole?: string } {
  const k = spec.claims_filed?.kinds.find((x) => x.id === claim.kind);
  const p = k?.prices;
  if (!p) return { items: [] };
  if (p.whole) return { items: [], helperWhole: p.whole };
  const fam = p.family ?? "";
  const fa = familyAttrOf(p.section);
  const own = (items ?? []).find((it) => (it.section ?? undefined) === (p.section ?? undefined)
    && String(it.attributes?.[fa]?.value ?? "").trim() === fam);
  if (own) return { items: [own] };
  return { items: [{ attributes: { [fa]: { value: fam, confidence: 1 } }, qtyPerRowUnit: 1, ...(p.section ? { section: p.section } : {}) }] };
}
