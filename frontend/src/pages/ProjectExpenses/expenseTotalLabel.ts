/**
 * The label of the Misc. Project Expenses card's total (#1542). The card totals what the list shows:
 * on a project, Paid expenses only; on the standalone list, the status tab in view ("All" = every
 * status). Only Paid expenses are settled spend (`GLOSSARY.md`), so the label says which ones these are.
 */
export const expenseTotalLabel = (statusTab: string): string =>
    statusTab === "All" ? "Expenses, All Statuses" : `${statusTab} Expenses`;
