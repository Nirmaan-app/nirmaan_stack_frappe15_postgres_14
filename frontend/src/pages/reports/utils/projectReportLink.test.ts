import { describe, expect, it } from "vitest";

import { projectReportLink } from "./projectReportLink";

describe("projectReportLink (Cash Sheet -> a project's Inflow / Payments report, walk W8)", () => {
  it("names the report, its table's filter key and the project filter, with the date range when set", () => {
    const link = projectReportLink("Outflow Report(Project)", "PROJ-1", { from: "2026-04-01", to: "2026-10-22" });
    expect(link.report).toBe("Outflow Report(Project)");
    expect(link.filterKey).toBe("outflow_report_table_filters");
    expect(link.filterList).toEqual([
      { id: "project", value: ["PROJ-1"] },
      { id: "payment_date", value: { operator: "Between", value: ["2026-04-01", "2026-10-22"] } },
    ]);
    // The URL form the report's table reads back (`useServerDataTable`: base64 of the JSON list).
    expect(atob(link.filters)).toBe(JSON.stringify(link.filterList));
    expect(link.url).toBe(
      `/reports?tab=projects&report=Outflow%20Report(Project)&outflow_report_table_filters=${link.filters}`
    );
  });

  it("filters the Inflow Report on the project alone without a date range", () => {
    const link = projectReportLink("Inflow Report", "PROJ-1", undefined);
    expect(link.filterKey).toBe("inflow_report_table_filters");
    expect(link.filterList).toEqual([{ id: "project", value: ["PROJ-1"] }]);
  });
});
