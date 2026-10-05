/**
 * SLICE 12c-P (2026-10-06) -- THE DIVERGENCES AWAITING OWNER REVIEW.
 *
 * Owner (standing, P1): the calculator and the rate-helper panel must always give the same price for
 * the same inputs. Owner (item 7, amended 2026-10-06): a divergence does NOT stop the run -- record it
 * in full, group it by cause, and list it HERE BY NAME as awaiting review. The permanent parity test
 * passes only if EXACTLY these differ: a NEW divergence fails it, and so does a listed one that stops
 * differing (which would mean someone fixed or masked it without the owner ruling on it).
 *
 * Every entry was measured by `calculatorPanelParity.test.ts` over all 96 stored
 * `BoQ Rate Suggestion Run` documents (10,460 rows, 4,695 distinct input classes) and over the whole
 * live catalogue (1,402 Electrical + 331 HVAC active items). The FULL per-divergence record -- inputs,
 * both figures, both item lists, both refusal reasons and the step where the paths first differ -- is in
 * the slice's report; the four causes are documented on `DivergenceCause` in the harness.
 *
 * ⚠️ NOTHING HERE IS A FIX. No product file changed in this slice.
 *
 * COUNTS AS MEASURED:
 *   A_wiring_primary     73 classes /  188 rows  -- which block is OFFERED, chosen by the row text
 *   B_stale_pick         11 classes /   11 rows  -- THE ONLY cause where one surface prices and the other does not
 *   C_unit_not_offered    5 classes /    5 rows  -- the row's unit is not one the picker offers
 *   D_reason_only         8 classes /    8 rows  -- both refuse; the sentence differs
 *   (sweeps)             13 cases              -- all D, on synthetic above-the-largest / between-rung sizes
 */
import type { DivergenceCause } from "./calculatorPanelParity.harness";

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
  { id: "BRSR-26-01308#88", cat: "hvac_adp", cause: "B_stale_pick", rows: 1 },
  { id: "BRSR-26-01310#276", cat: "hvac_adp", cause: "B_stale_pick", rows: 1 },
  { id: "BRSR-26-01311#25", cat: "hvac_adp", cause: "B_stale_pick", rows: 1 },
  { id: "BRSR-26-01311#27", cat: "hvac_adp", cause: "B_stale_pick", rows: 1 },
  { id: "BRSR-26-01311#42", cat: "hvac_adp", cause: "D_reason_only", rows: 1 },
  { id: "BRSR-26-01311#52", cat: "hvac_adp", cause: "C_unit_not_offered", rows: 1 },
  { id: "BRSR-26-01311#93", cat: "hvac_adp", cause: "B_stale_pick", rows: 1 },
  { id: "BRSR-26-01311#94", cat: "hvac_adp", cause: "B_stale_pick", rows: 1 },
  { id: "BRSR-26-01312#51", cat: "hvac_adp", cause: "B_stale_pick", rows: 1 },
  { id: "BRSR-26-01313#54", cat: "hvac_adp", cause: "B_stale_pick", rows: 1 },
  { id: "BRSR-26-01313#55", cat: "hvac_adp", cause: "B_stale_pick", rows: 1 },
  { id: "BRSR-26-01315#82", cat: "hvac_adp", cause: "B_stale_pick", rows: 1 },
  { id: "BRSR-26-01315#89", cat: "hvac_adp", cause: "D_reason_only", rows: 1 },
  { id: "BRSR-26-01315#94", cat: "hvac_adp", cause: "D_reason_only", rows: 1 },
  { id: "BRSR-26-01315#160", cat: "hvac_adp", cause: "D_reason_only", rows: 1 },
  { id: "BRSR-26-01369#43", cat: "hvac_adp", cause: "C_unit_not_offered", rows: 1 },
  { id: "BRSR-26-01370#59", cat: "hvac_adp", cause: "D_reason_only", rows: 1 },
  { id: "BRSR-26-01370#80", cat: "hvac_adp", cause: "C_unit_not_offered", rows: 1 },
  { id: "BRSR-26-01370#83", cat: "hvac_adp", cause: "C_unit_not_offered", rows: 1 },
  { id: "BRSR-26-01370#84", cat: "hvac_adp", cause: "C_unit_not_offered", rows: 1 },
  { id: "BRSR-26-01371#88", cat: "hvac_adp", cause: "B_stale_pick", rows: 1 },
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
