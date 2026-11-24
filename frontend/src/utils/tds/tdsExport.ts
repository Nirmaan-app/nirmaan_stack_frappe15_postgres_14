/**
 * The TDS report export (`api/tds/tds_report.start_tds_export`) as a screen reads it: the one typed accessor for
 * what the finished operation returned and what its start was given (F2). The TDS Repository tab and the
 * Handover Documents tab both start it; `utils/tds/deliverTdsExport` hands over the PDF for both.
 */
import { format } from "date-fns";

import { isRecord, parseResultFile } from "@/utils/backgroundOps/operationFollower";

/** What a screen gives `start` for a TDS export, kept across a reload. */
export interface TdsExportContext {
  /** Hold the PDF for the in-app preview instead of saving it (`isPdfPreviewOnly`). */
  previewOnly: boolean;
  /** The file's name when the result names none. */
  fallbackName: string;
}

export interface TdsExport {
  previewOnly: boolean;
  filename: string;
  /** The items whose data sheet the server could not include. */
  failedItems: string[];
}

/** PURE. A finished TDS export: `result` as `tds_export_op` returned it, `context` as the screen started it. */
export function readTdsExport(result: unknown, context: unknown): TdsExport {
  const started = isRecord(context) ? context : {};
  const failed = isRecord(result) && Array.isArray(result.failed_items) ? result.failed_items : [];
  return {
    previewOnly: started.previewOnly === true,
    filename:
      parseResultFile(result)?.filename ||
      (typeof started.fallbackName === "string" && started.fallbackName ? started.fallbackName : "TDS_Report.pdf"),
    failedItems: failed.map(String),
  };
}

/** PURE. A TDS export's `fallbackName`: the parts and the day (dd-MMM-yyyy) joined by `_`, every character of a part
 *  that is not a letter, a digit, `-` or `_` made `_`. */
export function tdsExportFallbackName(parts: string[], day: Date): string {
  return `${[...parts.map((part) => part.replace(/[^a-zA-Z0-9-_]/g, "_")), format(day, "dd-MMM-yyyy")].join("_")}.pdf`;
}
