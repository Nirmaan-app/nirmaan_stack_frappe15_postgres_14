import { describe, expect, it } from "vitest";

import { readTdsExport, tdsExportFallbackName } from "./tdsExport";

// `tds_export_op` returns {"failed_items": [...]} and `write_result_file` adds the file it kept.
const finished = (failed_items: unknown, filename = "TDS_Report_Tower_A_2026-11-19.pdf") => ({
  failed_items,
  file: { filename, size_bytes: 2048 },
});

describe("readTdsExport", () => {
  it("names the server's file, the items it could not include, and whether the start asked for a preview", () => {
    expect(readTdsExport(finished(["Chiller CH-1", "AHU-2"]), { previewOnly: true, fallbackName: "x.pdf" })).toEqual({
      previewOnly: true,
      filename: "TDS_Report_Tower_A_2026-11-19.pdf",
      failedItems: ["Chiller CH-1", "AHU-2"],
    });
  });

  it("uses the start's fallback name when the result names no file", () => {
    expect(readTdsExport({ failed_items: [] }, { previewOnly: false, fallbackName: "Tower_A_TDS_19-Nov-2026.pdf" }))
      .toEqual({ previewOnly: false, filename: "Tower_A_TDS_19-Nov-2026.pdf", failedItems: [] });
  });

  it("NEGATIVE: a result or context of another shape reads as a download of TDS_Report.pdf with no gaps", () => {
    expect(readTdsExport(null, undefined)).toEqual({ previewOnly: false, filename: "TDS_Report.pdf", failedItems: [] });
    expect(readTdsExport({ failed_items: "AHU-2" }, { previewOnly: "yes" }))
      .toEqual({ previewOnly: false, filename: "TDS_Report.pdf", failedItems: [] });
  });
});

describe("tdsExportFallbackName", () => {
  const day = new Date(2026, 10, 19);

  it("joins the parts and the day, each part safe for a file name", () => {
    expect(tdsExportFallbackName(["TDS_Report", "Tower A / Phase-2"], day))
      .toBe("TDS_Report_Tower_A___Phase-2_19-Nov-2026.pdf");
    expect(tdsExportFallbackName(["Tower A", "HVAC_Material_Data_Sheet"], day))
      .toBe("Tower_A_HVAC_Material_Data_Sheet_19-Nov-2026.pdf");
  });
});
