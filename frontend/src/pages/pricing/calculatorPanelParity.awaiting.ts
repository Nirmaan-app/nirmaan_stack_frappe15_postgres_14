/**
 * SLICE 12c-P / 12c-F -- THE PARITY LIST: WHAT STILL DIFFERS, AND WHAT THE OWNER HAS RULED ON.
 *
 * Owner (standing, P1): the calculator and the rate-helper panel must always give the same price for
 * the same inputs. Owner (12c-P item 7): a divergence does NOT stop the run -- record it in full,
 * group it by cause, and list it here BY NAME. The permanent parity test passes only if EXACTLY these
 * differ: a NEW divergence fails it, and so does a listed one that stops differing (which would mean
 * someone fixed or masked it without the owner ruling on it).
 *
 * ⚠️ 12c-F CLOSED TWO CAUSES AND THE OWNER ACCEPTED TWO MORE (2026-10-06). The list went from 97
 * corpus classes to 86:
 *
 *   FIXED, so REMOVED from this list:
 *     B_stale_pick        11 -> 0   fix B: a model-read value is matched to the dropdown option it
 *                                   means ("3 Slot" -> "3"), so the field shows the value the rate was
 *                                   computed from. 8 of the 11 now agree to the rupee; the other 3
 *                                   were never value problems and are reclassified C below.
 *     C_unit_not_offered   5 -> 5   fix C: the picker now also offers the units the pricing can
 *                                   CONVERT into one the item is sold in (sq.ft -> sq.m). The three
 *                                   sq.ft rows now agree; the 5 that remain are the 2 that were always
 *                                   unit-shaped plus the 3 inherited from B.
 *
 *   ACCEPTED BY OWNER, so still listed but NOT awaiting anything:
 *     A_wiring_primary    73        R-A: "A is ok - nothin gto be done". Which block is OFFERED is
 *                                   chosen by the row's TEXT and the calculator has no text field;
 *                                   every BLOCK's figures agree on both surfaces.
 *     D_reason_only        8        R-D: "its ok. let it be". Both surfaces refuse; only the sentence
 *                                   differs, because the panel's note can quote BoQ text that has no
 *                                   box on the screen.
 *
 *     C_unit_not_offered   5 -> 3   12c-U. The cause SPLIT, because the five rows were never one
 *                                   thing -- some BoQs said a unit that was WRONG for the item, and
 *                                   some said NOTHING AT ALL, and the owner ruled those opposite ways.
 *
 *                                   REMOVED, because they now agree on both surfaces:
 *                                     BRSR-26-01312#51  unit "R/O"   -> both price 334 / 0 / 334
 *                                     BRSR-26-01369#43  no unit      -> both refuse "no diameter
 *                                                                       stated" (the row states no
 *                                                                       diameter; resolving its unit
 *                                                                       could not conjure one)
 *                                   Owner U2 / U3: a row that states no unit, or "rate only", is
 *                                   priced in the catalogue's unit for its item -- here "per number",
 *                                   both items being priced by number and nothing else.
 *
 *                                   KEPT and now ACCEPTED (owner U1, "all theseshould refuse
 *                                   pricing"): BRSR-26-01311#25 and #27 (a spigot row written per
 *                                   metre) and BRSR-26-01311#52 (an actuator row per sq.m). The BoQ
 *                                   SAID a unit and it was wrong for the item, which is a different
 *                                   fact from the BoQ saying nothing -- so the panel refusing is
 *                                   CORRECT, and what the calculator does with a unit of its own
 *                                   choosing is not a price the panel should copy.
 *
 *   STILL AWAITING THE OWNER:
 *     nothing in this corpus. The double-skin-plenum Nos case is a FAMILY-level observation (that
 *     family declares the count class not offered) and has no row here; it is left for 12d.
 *
 * ⚠️ NOTHING HERE IS A FIX. `STATUS_BY_CAUSE` records the owner's ruling; it changes no behaviour.
 */
import type { DivergenceCause } from "./calculatorPanelParity.harness";

/** Where a cause stands with the owner. A cause is ACCEPTED when the owner has looked at it and ruled
 *  that nothing is to be done; it is still listed, because the test must still see exactly these. */
export type DivergenceStatus = "accepted by owner" | "awaiting owner review";

export const STATUS_BY_CAUSE: Readonly<Record<DivergenceCause, DivergenceStatus>> = {
  A_wiring_primary: "accepted by owner",   // owner R-A, 2026-10-06
  B_stale_pick: "awaiting owner review",   // fixed in 12c-F; no row carries it any more
  C_unit_not_offered: "accepted by owner",  // owner U1, 2026-10-07
  D_reason_only: "accepted by owner",      // owner R-D, 2026-10-06
  Z_UNCLASSIFIED: "awaiting owner review",
};

/** One corpus divergence: `id` is the first member of its input class, `rows` how many stored rows
 *  share that exact input and therefore diverge identically. */
export interface AwaitingCorpusDivergence {
  id: string;
  cat: string;
  cause: DivergenceCause;
  rows: number;
}

/** One catalogue-sweep divergence, named by the case that produced it. */
export interface AwaitingSweepDivergence {
  cat: string;
  unit: string;
  item: Record<string, string | number | null> | null;
  cause: DivergenceCause;
}

export const AWAITING_CORPUS_DIVERGENCES: readonly AwaitingCorpusDivergence[] = [
  { id: "BRSR-26-00012#69", cat: "wiring_cabling", cause: "A_wiring_primary", rows: 2 },
  { id: "BRSR-26-00012#72", cat: "wiring_cabling", cause: "A_wiring_primary", rows: 2 },
  { id: "BRSR-26-00012#75", cat: "wiring_cabling", cause: "A_wiring_primary", rows: 2 },
  { id: "BRSR-26-00012#77", cat: "wiring_cabling", cause: "A_wiring_primary", rows: 2 },
  { id: "BRSR-26-00012#79", cat: "wiring_cabling", cause: "A_wiring_primary", rows: 2 },
  { id: "BRSR-26-00013#271", cat: "wiring_cabling", cause: "A_wiring_primary", rows: 2 },
  { id: "BRSR-26-00015#476", cat: "wiring_cabling", cause: "A_wiring_primary", rows: 3 },
  { id: "BRSR-26-00015#478", cat: "wiring_cabling", cause: "A_wiring_primary", rows: 3 },
  { id: "BRSR-26-00018#194", cat: "wiring_cabling", cause: "A_wiring_primary", rows: 1 },
  { id: "BRSR-26-00018#198", cat: "wiring_cabling", cause: "A_wiring_primary", rows: 1 },
  { id: "BRSR-26-00023#126", cat: "wiring_cabling", cause: "A_wiring_primary", rows: 1 },
  { id: "BRSR-26-00023#127", cat: "wiring_cabling", cause: "A_wiring_primary", rows: 1 },
  { id: "BRSR-26-00029#43", cat: "wiring_cabling", cause: "A_wiring_primary", rows: 1 },
  { id: "BRSR-26-00029#44", cat: "wiring_cabling", cause: "A_wiring_primary", rows: 1 },
  { id: "BRSR-26-00037#206", cat: "wiring_cabling", cause: "A_wiring_primary", rows: 2 },
  { id: "BRSR-26-00037#207", cat: "wiring_cabling", cause: "A_wiring_primary", rows: 2 },
  { id: "BRSR-26-00038#88", cat: "wiring_cabling", cause: "A_wiring_primary", rows: 1 },
  { id: "BRSR-26-00038#90", cat: "wiring_cabling", cause: "A_wiring_primary", rows: 1 },
  { id: "BRSR-26-00041#24", cat: "wiring_cabling", cause: "A_wiring_primary", rows: 1 },
  { id: "BRSR-26-00041#26", cat: "wiring_cabling", cause: "A_wiring_primary", rows: 1 },
  { id: "BRSR-26-00041#27", cat: "wiring_cabling", cause: "A_wiring_primary", rows: 1 },
  { id: "BRSR-26-00041#28", cat: "wiring_cabling", cause: "A_wiring_primary", rows: 1 },
  { id: "BRSR-26-00041#29", cat: "wiring_cabling", cause: "A_wiring_primary", rows: 1 },
  { id: "BRSR-26-00041#30", cat: "wiring_cabling", cause: "A_wiring_primary", rows: 1 },
  { id: "BRSR-26-00041#31", cat: "wiring_cabling", cause: "A_wiring_primary", rows: 1 },
  { id: "BRSR-26-00041#32", cat: "wiring_cabling", cause: "A_wiring_primary", rows: 1 },
  { id: "BRSR-26-00041#34", cat: "wiring_cabling", cause: "A_wiring_primary", rows: 1 },
  { id: "BRSR-26-00041#35", cat: "wiring_cabling", cause: "A_wiring_primary", rows: 1 },
  { id: "BRSR-26-00041#164", cat: "wiring_cabling", cause: "A_wiring_primary", rows: 1 },
  { id: "BRSR-26-00041#166", cat: "wiring_cabling", cause: "A_wiring_primary", rows: 1 },
  { id: "BRSR-26-00041#168", cat: "wiring_cabling", cause: "A_wiring_primary", rows: 1 },
  { id: "BRSR-26-00041#170", cat: "wiring_cabling", cause: "A_wiring_primary", rows: 1 },
  { id: "BRSR-26-00041#171", cat: "wiring_cabling", cause: "A_wiring_primary", rows: 1 },
  { id: "BRSR-26-00041#172", cat: "wiring_cabling", cause: "A_wiring_primary", rows: 1 },
  { id: "BRSR-26-00046#117", cat: "wiring_cabling", cause: "A_wiring_primary", rows: 3 },
  { id: "BRSR-26-00046#120", cat: "wiring_cabling", cause: "A_wiring_primary", rows: 3 },
  { id: "BRSR-26-00046#123", cat: "wiring_cabling", cause: "A_wiring_primary", rows: 3 },
  { id: "BRSR-26-00046#126", cat: "wiring_cabling", cause: "A_wiring_primary", rows: 6 },
  { id: "BRSR-26-00046#131", cat: "wiring_cabling", cause: "A_wiring_primary", rows: 3 },
  { id: "BRSR-26-00046#137", cat: "wiring_cabling", cause: "A_wiring_primary", rows: 3 },
  { id: "BRSR-26-00046#140", cat: "wiring_cabling", cause: "A_wiring_primary", rows: 3 },
  { id: "BRSR-26-00046#143", cat: "wiring_cabling", cause: "A_wiring_primary", rows: 3 },
  { id: "BRSR-26-00197#80", cat: "wiring_cabling", cause: "A_wiring_primary", rows: 8 },
  { id: "BRSR-26-00197#81", cat: "wiring_cabling", cause: "A_wiring_primary", rows: 8 },
  { id: "BRSR-26-00197#82", cat: "wiring_cabling", cause: "A_wiring_primary", rows: 8 },
  { id: "BRSR-26-00197#83", cat: "wiring_cabling", cause: "A_wiring_primary", rows: 8 },
  { id: "BRSR-26-00197#84", cat: "wiring_cabling", cause: "A_wiring_primary", rows: 8 },
  { id: "BRSR-26-00197#85", cat: "wiring_cabling", cause: "A_wiring_primary", rows: 8 },
  { id: "BRSR-26-00197#86", cat: "wiring_cabling", cause: "A_wiring_primary", rows: 8 },
  { id: "BRSR-26-00197#87", cat: "wiring_cabling", cause: "A_wiring_primary", rows: 8 },
  { id: "BRSR-26-00197#88", cat: "wiring_cabling", cause: "A_wiring_primary", rows: 8 },
  { id: "BRSR-26-00197#89", cat: "wiring_cabling", cause: "A_wiring_primary", rows: 8 },
  { id: "BRSR-26-00197#90", cat: "wiring_cabling", cause: "A_wiring_primary", rows: 8 },
  { id: "BRSR-26-00197#91", cat: "wiring_cabling", cause: "A_wiring_primary", rows: 8 },
  { id: "BRSR-26-00520#275", cat: "wiring_cabling", cause: "A_wiring_primary", rows: 1 },
  { id: "BRSR-26-00520#276", cat: "wiring_cabling", cause: "A_wiring_primary", rows: 1 },
  { id: "BRSR-26-00520#277", cat: "wiring_cabling", cause: "A_wiring_primary", rows: 1 },
  { id: "BRSR-26-00520#278", cat: "wiring_cabling", cause: "A_wiring_primary", rows: 1 },
  { id: "BRSR-26-00520#279", cat: "wiring_cabling", cause: "A_wiring_primary", rows: 1 },
  { id: "BRSR-26-00520#280", cat: "wiring_cabling", cause: "A_wiring_primary", rows: 1 },
  { id: "BRSR-26-00520#290", cat: "wiring_cabling", cause: "A_wiring_primary", rows: 1 },
  { id: "BRSR-26-00520#291", cat: "wiring_cabling", cause: "A_wiring_primary", rows: 1 },
  { id: "BRSR-26-00520#292", cat: "wiring_cabling", cause: "A_wiring_primary", rows: 1 },
  { id: "BRSR-26-00520#293", cat: "wiring_cabling", cause: "A_wiring_primary", rows: 1 },
  { id: "BRSR-26-00520#294", cat: "wiring_cabling", cause: "A_wiring_primary", rows: 1 },
  { id: "BRSR-26-00520#295", cat: "wiring_cabling", cause: "A_wiring_primary", rows: 1 },
  { id: "BRSR-26-00520#296", cat: "wiring_cabling", cause: "A_wiring_primary", rows: 1 },
  { id: "BRSR-26-00520#302", cat: "wiring_cabling", cause: "A_wiring_primary", rows: 1 },
  { id: "BRSR-26-00520#303", cat: "wiring_cabling", cause: "A_wiring_primary", rows: 1 },
  { id: "BRSR-26-00520#304", cat: "wiring_cabling", cause: "A_wiring_primary", rows: 1 },
  { id: "BRSR-26-00520#597", cat: "wiring_cabling", cause: "A_wiring_primary", rows: 1 },
  { id: "BRSR-26-00520#598", cat: "wiring_cabling", cause: "A_wiring_primary", rows: 1 },
  { id: "BRSR-26-00520#599", cat: "wiring_cabling", cause: "A_wiring_primary", rows: 1 },
  { id: "BRSR-26-01307#152", cat: "hvac_adp", cause: "D_reason_only", rows: 1 },
  { id: "BRSR-26-01307#170", cat: "hvac_adp", cause: "D_reason_only", rows: 1 },
  { id: "BRSR-26-01307#171", cat: "hvac_adp", cause: "D_reason_only", rows: 1 },
  { id: "BRSR-26-01311#25", cat: "hvac_adp", cause: "C_unit_not_offered", rows: 1 },
  { id: "BRSR-26-01311#27", cat: "hvac_adp", cause: "C_unit_not_offered", rows: 1 },
  { id: "BRSR-26-01311#42", cat: "hvac_adp", cause: "D_reason_only", rows: 1 },
  { id: "BRSR-26-01311#52", cat: "hvac_adp", cause: "C_unit_not_offered", rows: 1 },
  { id: "BRSR-26-01315#89", cat: "hvac_adp", cause: "D_reason_only", rows: 1 },
  { id: "BRSR-26-01315#94", cat: "hvac_adp", cause: "D_reason_only", rows: 1 },
  { id: "BRSR-26-01315#160", cat: "hvac_adp", cause: "D_reason_only", rows: 1 },
  { id: "BRSR-26-01370#59", cat: "hvac_adp", cause: "D_reason_only", rows: 1 },
];

export const AWAITING_SWEEP_DIVERGENCES: readonly AwaitingSweepDivergence[] = [
  { cat: "hvac_adp", unit: "nos", item: {"family":"actuator","ul":"no","torque":"1020"}, cause: "D_reason_only" },
  { cat: "hvac_adp", unit: "nos", item: {"family":"control panel","panel_ratio":"1012"}, cause: "D_reason_only" },
  { cat: "hvac_adp", unit: "rmt", item: {"family":"slot diffuser","damper":"with","slot_count":"1003"}, cause: "D_reason_only" },
  { cat: "hvac_adp", unit: "rmt", item: {"family":"slot diffuser","damper":"with","slot_count":"2.5"}, cause: "D_reason_only" },
  { cat: "hvac_adp", unit: "nos", item: {"family":"square diffuser","damper":"with","neck_mm":"1450"}, cause: "D_reason_only" },
  { cat: "hvac_adp", unit: "nos", item: {"family":"round diffuser","damper":"with","dia_mm":"1400"}, cause: "D_reason_only" },
  { cat: "hvac_adp", unit: "nos", item: {"family":"jet / eyeball diffuser","dia_mm":"1300"}, cause: "D_reason_only" },
  { cat: "hvac_adp", unit: "nos", item: {"family":"butterfly damper","dia_mm":"1350"}, cause: "D_reason_only" },
  { cat: "hvac_adp", unit: "nos", item: {"family":"spigot","dia_mm":"1350"}, cause: "D_reason_only" },
  { cat: "hvac_adp", unit: "rmt", item: {"family":"flexible duct","insulated":"with","dia_mm":"1350"}, cause: "D_reason_only" },
  { cat: "hvac_adp", unit: "nos", item: {"family":"flexible duct","insulated":"with","dia_mm":"1350"}, cause: "D_reason_only" },
  { cat: "hvac_adp", unit: "nos", item: {"family":"disc valve","dia_mm":"1150"}, cause: "D_reason_only" },
  { cat: "hvac_adp", unit: "sqm", item: {"family":"double-skin plenum","insulation_thickness_mm":"1050"}, cause: "D_reason_only" },
];
