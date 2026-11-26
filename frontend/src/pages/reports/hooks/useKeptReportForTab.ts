import { useCallback, useEffect, useRef } from "react";

import { REPORTS_TABS } from "../constants";
import { AuditViewReportType, ReportType } from "../store/useReportStore";

/**
 * The report type to reopen when a Reports tab is clicked; null means the tab's default.
 *
 * Audit View keeps its Report Type while Reports stays open. Every other tab starts on its default, but
 * Vendors -> back to Audit View must reopen Non Project View if that was open: its step 1 / step 2 pick
 * (`audit_range`, `audit_tab`) is still in the URL, and under All Project View it would open the other
 * view's tab with both steps already done.
 */
export function useKeptReportForTab(activeTab: string, selectedReportType: ReportType) {
  const lastAuditViewType = useRef<AuditViewReportType | null>(null);
  useEffect(() => {
    if (activeTab === REPORTS_TABS.AUDIT_VIEW && (selectedReportType === "All Project View" || selectedReportType === "Non Project View")) {
      lastAuditViewType.current = selectedReportType;
    }
  }, [activeTab, selectedReportType]);

  return useCallback(
    (tab: string): AuditViewReportType | null => (tab === REPORTS_TABS.AUDIT_VIEW ? lastAuditViewType.current : null),
    [],
  );
}
