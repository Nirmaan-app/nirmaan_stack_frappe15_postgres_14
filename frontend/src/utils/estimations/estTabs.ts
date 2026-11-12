/**
 * The project page's Estimates tab and its three sub-tabs (plan "BOQ Estimates", decision N, owner 2026-11-11):
 * one project tab, `?page=estimates`, holding BOQ View, Line Item View and Estimate Items. The open sub-tab is
 * kept in its own URL parameter, `estTab`, the way the Financials tab keeps `fTab`.
 */

/** The `estTab` URL parameter. */
export const EST_TAB_PARAM = "estTab";

/** The open BOQ, sheet (its name, verbatim) and expanded line's Excel row, shared by the three sub-tabs. */
export const EST_BOQ_PARAM = "estBoq";
export const EST_SHEET_PARAM = "estSheet";
export const EST_ROW_PARAM = "estRow";

/** The three sub-tabs, in display order. */
export const EST_TABS = [
  { value: "boq-view", label: "BOQ View" },
  { value: "line-item-view", label: "Line Item View" },
  { value: "estimate-items", label: "Estimate Items" },
] as const;

/** A sub-tab's URL value. */
export type EstTab = (typeof EST_TABS)[number]["value"];

/** The sub-tab a missing or unknown `estTab` opens. */
export const DEFAULT_EST_TAB: EstTab = "boq-view";

/**
 * Reads a URL value as a sub-tab. Anything that is not one of the three (missing, from an old link, typed by
 * hand, different case) opens the first sub-tab instead of an empty panel.
 */
export function toEstTab(value: string | null | undefined): EstTab {
  const found = EST_TABS.find((tab) => tab.value === value);
  return found ? found.value : DEFAULT_EST_TAB;
}
