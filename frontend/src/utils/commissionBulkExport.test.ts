import { describe, expect, it } from "vitest";

import { commissionExportOf, commissionExportOutcome } from "./commissionBulkExport";

const OP = "aaaaaaaa-0000-4000-8000-000000000001";

describe("the commission export as the dialog shows it", () => {
    it("is idle with nothing followed, and waiting apart from preparing", () => {
        expect(commissionExportOf({ phase: "idle" })).toEqual({ exporting: false, queued: false, progress: null });
        expect(commissionExportOf({ phase: "starting", opId: OP })).toEqual({ exporting: true, queued: true, progress: null });
        expect(commissionExportOf({ phase: "queued", opId: OP })).toEqual({ exporting: true, queued: true, progress: null });
    });

    it("counts the reports from its own record's progress", () => {
        const view = { phase: "running" as const, opId: OP, progress: { percent: 50, message: null, detail: { done: 2, total: 4 } } };
        expect(commissionExportOf(view)).toEqual({ exporting: true, queued: false, progress: { done: 2, total: 4 } });
        expect(commissionExportOf({ phase: "running", opId: OP, progress: null }).progress).toBeNull();
    });

    it("an ended export no longer holds the dialog", () => {
        expect(commissionExportOf({ phase: "finished", opId: OP, result: {} }).exporting).toBe(false);
        expect(commissionExportOf({ phase: "failed", opId: OP, error: "x" }).exporting).toBe(false);
    });

    it("says when some reports could not be generated", () => {
        expect(commissionExportOutcome({ rendered: 3, failed: 1, total: 4 })).toMatchObject({
            title: "Exported with issues",
            description: "3 of 4 report(s) downloaded; 1 could not be generated.",
            variant: "destructive",
        });
        expect(commissionExportOutcome({ rendered: 4, failed: 0, total: 4 })).toMatchObject({ title: "Exported", variant: "success" });
    });
});
