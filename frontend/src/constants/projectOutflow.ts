/**
 * Hover text for the glossary's *Project outflow* (`GLOSSARY.md`, `services/project_money.py`), the only
 * figure a screen may call "outflow" (#1542). Shared by the Projects list and the Cash Sheet, which
 * show the same server figure.
 */
export const PROJECT_OUTFLOW_TOOLTIP =
  "Cash paid out for the project: Paid PO and WO payments, less Received vendor refunds, plus Paid project expenses, plus the TDS on Paid PO and WO payments (withheld from the vendor or paid by the company). Settled only; excludes scheduled credit terms.";

export const CASHFLOW_GAP_TOOLTIP =
  "Project Outflow + Current Liabilities − Inflow. Positive (red) means committed spend exceeds funds received; negative (green) means inflows are ahead.";
