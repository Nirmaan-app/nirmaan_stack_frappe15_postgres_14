import { Navigate, useLocation } from "react-router-dom";

import { chequeTrackerPathFromLegacyReport } from "@/utils/cheques/chequeReportLink";

import ReportsContainer from "./ReportsContainer";

/**
 * `/reports`. The Cheque Payment report moved to its own page, the Cheque Tracker (#1483): an old link to it
 * (`?report=Cheque Payment…`, from a bookmark or an earlier build) lands there with its search and filters.
 * Every other link opens the Reports hub.
 */
export default function ReportsIndex() {
    const { search } = useLocation();
    const tracker = chequeTrackerPathFromLegacyReport(search);
    if (tracker) return <Navigate to={tracker} replace />;
    return <ReportsContainer />;
}
