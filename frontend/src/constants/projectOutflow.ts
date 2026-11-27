/**
 * The ⓘ hover points of the money columns that the Projects list and the Cash Sheet (Projects report) share,
 * as bullet points: the owner's "short version" of the column tooltips page (2026-11-27). Each states what the
 * server figure counts (`services/project_money.py`, `api/projects/project_aggregates.py`); only the wording is
 * chosen here. *Project outflow* is the glossary's (`GLOSSARY.md`), the only figure a screen may call "outflow"
 * (#1542).
 */

/** One point of a column's ⓘ: a line, or a line with its own sub-points. */
export type TooltipPoint = string | { text: string; points: readonly string[] };

export const NOTIONAL_GST_POINTS: readonly TooltipPoint[] = [
  "GST not charged on Work Orders without GST",
  "= 18% × Work Order total",
  "Approved Work Orders only",
];

export const INFLOW_POINTS: readonly TooltipPoint[] = ["All money received from the client for this project"];

export const PROJECT_OUTFLOW_POINTS: readonly TooltipPoint[] = [
  {
    text: "Money paid out for this project:",
    points: [
      "+ Paid PO & Work Order payments",
      "+ TDS on those payments",
      "+ Paid project expenses",
      "− Money vendors returned to us",
    ],
  },
  "Not included: future credit payments, and TDS paid later to the government",
];

export const CURRENT_LIABILITIES_POINTS: readonly TooltipPoint[] = [
  "Money we still owe for goods already delivered",
  "= Delivered − Amount Paid, for each PO (never below 0)",
  "Amount Paid includes TDS cut from the vendor, minus money the vendor returned",
];

export const TOTAL_CREDIT_PURCHASE_POINTS: readonly TooltipPoint[] = [
  "Value bought on credit terms (PO payment terms of type Credit)",
  "Counts every credit term, paid or not yet paid",
];

export const CASHFLOW_GAP_POINTS: readonly TooltipPoint[] = [
  "= Project Outflow + Current Liabilities − Inflow",
  "Red: spent + owed is more than the client paid",
  "Green: client paid is more than spent + owed",
];
