import { REPORTS_TABS } from "@/pages/reports/constants";

/**
 * Where a Cheque is opened from outside the report (spec #1407): Reports > Payment > Cheque Payment,
 * searched by its cheque number. The report keeps its search in the URL (`useServerDataTable`'s
 * `urlSyncKey` "cheques"), so the link lands on that cheque's row.
 *
 * A router path: hand it to `<Link to>` / `navigate`, which add the app's basename.
 */
export const chequeReportPath = (chequeNo: string): string => {
    const params = new URLSearchParams({
        tab: REPORTS_TABS.PAYMENT_TDS,
        report: "Cheque Payment",
        cheques_q: chequeNo,
        cheques_searchBy: "cheque_no",
    });
    return `/reports?${params.toString()}`;
};
