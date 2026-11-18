/**
 * The commission bulk export (`api/commission_report/bulk_download_reports.py`) as its dialog shows it: whether an
 * export holds the dialog, whether it still waits in the queue, how many reports are done (from the operation's
 * own record, ADR 0047), and the toast for the finished file.
 */
import type { OpView } from "@/utils/backgroundOps/operationFollower";

export interface CommissionExport {
    exporting: boolean;
    queued: boolean;
    progress: { done: number; total: number } | null;
}

export function commissionExportOf(view: OpView): CommissionExport {
    switch (view.phase) {
        case "starting":
        case "queued":
            return { exporting: true, queued: true, progress: null };
        case "running": {
            const detail = view.progress?.detail;
            const progress = typeof detail?.done === "number" && typeof detail?.total === "number"
                ? { done: detail.done, total: detail.total }
                : null;
            return { exporting: true, queued: false, progress };
        }
        default:
            return { exporting: false, queued: false, progress: null };
    }
}

const count = (result: unknown, key: string): number | null => {
    if (typeof result !== "object" || result === null) return null;
    const value = (result as Record<string, unknown>)[key];
    return typeof value === "number" ? value : null;
};

/** The toast for a finished export: `failed` reports were left out of the file. */
export function commissionExportOutcome(result: unknown) {
    const failed = count(result, "failed") ?? 0;
    return failed > 0
        ? {
            title: "Exported with issues",
            description: `${count(result, "rendered") ?? "?"} of ${count(result, "total") ?? "?"} report(s) downloaded; ${failed} could not be generated.`,
            variant: "destructive" as const,
        }
        : { title: "Exported", description: "Your merged PDF is downloading.", variant: "success" as const };
}
