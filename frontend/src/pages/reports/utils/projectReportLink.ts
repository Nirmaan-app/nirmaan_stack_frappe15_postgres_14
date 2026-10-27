/** The project reports the Cash Sheet links to, and the URL key their table reads its filters from. */
export type ProjectReportTarget = "Inflow Report" | "Outflow Report(Project)";

const FILTER_KEYS: Record<ProjectReportTarget, string> = {
  "Inflow Report": "inflow_report_table_filters",
  "Outflow Report(Project)": "outflow_report_table_filters",
};

export interface ProjectReportLink {
  report: ProjectReportTarget;
  /** The URL param the report's table reads its filters from (its `urlSyncKey` + `_filters`). */
  filterKey: string;
  /** The tanstack filter list the report's table opens with. */
  filterList: { id: string; value: unknown }[];
  /** The same, as the table stores it in the URL: base64 of its JSON. */
  filters: string;
  /** The whole link, for open-in-new-tab. */
  url: string;
}

/**
 * Where a Cash Sheet figure opens: the report filtered to the project (and the sheet's date range). The
 * click sets `filterKey` and `report` through `urlStateManager`, which the Reports page listens to, so the
 * report opens at once (walk W8: a router `Link` changed the URL but the page waited for a reload).
 */
export const projectReportLink = (
  report: ProjectReportTarget,
  projectId: string,
  dateRange: { from?: string; to?: string } | undefined
): ProjectReportLink => {
  const list: { id: string; value: unknown }[] = [{ id: "project", value: [projectId] }];
  if (dateRange?.from && dateRange?.to) {
    list.push({ id: "payment_date", value: { operator: "Between", value: [dateRange.from, dateRange.to] } });
  }
  const filters = btoa(JSON.stringify(list));
  const filterKey = FILTER_KEYS[report];
  return {
    report,
    filterKey,
    filterList: list,
    filters,
    url: `/reports?tab=projects&report=${encodeURIComponent(report)}&${filterKey}=${filters}`,
  };
};
