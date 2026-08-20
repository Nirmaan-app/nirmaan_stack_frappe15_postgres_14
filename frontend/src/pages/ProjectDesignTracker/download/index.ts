// frontend/src/pages/ProjectDesignTracker/download/index.ts
//
// The ONLY import surface for the design-tracker download feature.
// Consumers write:
//
//     import { DownloadReportDialog, useDownloadReport } from "./download";
//
// Anything not re-exported here is internal to the folder -- import it directly
// only from inside download/ (the pure module's helpers are re-exported for the
// test file, which sits in this folder too).

export { DownloadReportDialog } from "./DownloadReportDialog";
export type { DownloadReportDialogProps } from "./DownloadReportDialog";

export { useDownloadReport } from "./useDownloadReport";
export type { DownloadAvailability, UseDownloadReportResult } from "./useDownloadReport";

export type {
    DesignPhase,
    DownloadOption,
    DownloadSeed,
    DownloadSelection,
    DownloadableTask,
} from "./downloadTypes";
