// src/pages/reports/components/ProjectInvoicesReport.tsx
import React, { useCallback, useMemo } from "react";
import { formatISO } from "date-fns";

import AllProjectInvoices from "@/pages/ProjectInvoices/AllProjectInvoices";
import { StandaloneDateFilter } from "@/components/ui/StandaloneDateFilter";
import { useSharedReportDateRange } from "../store/useReportDateStore";

/**
 * Projects tab > "Project Invoices" report.
 *
 * Reuses the sidebar's Project Invoices sheet (`AllProjectInvoices`) verbatim —
 * same columns, facets, summary card and export — with two report-specific
 * differences:
 *
 *  1. The shared report date range (same picker as Cash Sheet / Inflow /
 *     Outflow) is applied server-side on `invoice_date`, so the table AND its
 *     summary aggregates cover only the selected period.
 *  2. Read-only: Edit / Delete / Add live on the sidebar page, not in a report.
 *
 * Its own `urlSyncKey` keeps the report's search/sort/facet state separate from
 * the sidebar page's.
 */
export const ProjectInvoicesReport: React.FC = () => {
  const { dateRange, onChange: onDateChange, onClear: onDateClear } =
    useSharedReportDateRange();

  // Server-side range filter on the invoice date. Empty => all invoices.
  const dateFilters = useMemo<Array<[string, string, string]>>(() => {
    if (!dateRange?.from || !dateRange?.to) return [];
    return [
      ["invoice_date", ">=", formatISO(dateRange.from, { representation: "date" })],
      ["invoice_date", "<=", formatISO(dateRange.to, { representation: "date" })],
    ];
  }, [dateRange]);

  const handleClearDateFilter = useCallback(() => {
    onDateClear(); // Reset to "ALL" (no date filtering)
  }, [onDateClear]);

  return (
    <div className="flex flex-col gap-2">
      <StandaloneDateFilter
        value={dateRange}
        onChange={onDateChange}
        onClear={handleClearDateFilter}
      />

      <AllProjectInvoices
        additionalFilters={dateFilters}
        urlSyncKey="project_invoices_report"
        disableActions
        dateFilterColumns={[]}
        tallContainerClassName="h-[calc(100vh-180px)]"
      />
    </div>
  );
};

export default ProjectInvoicesReport;
