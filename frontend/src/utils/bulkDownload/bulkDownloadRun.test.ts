import { describe, expect, it } from "vitest";
import {
    applyFailed, applyProgress, applyReady, isWorking, missingCount, runDetails, runTitle, startRun, timeLeft, unitNoun,
} from "./bulkDownloadRun";

const queued = () => startRun("PO", ["All POs", "With rate"]);

describe("the subtitle says what was asked for", () => {
    it("a Quick Download reads 'All …', a wizard download its selection", () => {
        expect(runDetails("PO", { withRate: true })).toEqual(["All POs", "With rate"]);
        expect(runDetails("WO", { selected: 2, withRate: false })).toEqual(["2 selected", "Without rate"]);
        expect(runDetails("DC", {})).toEqual(["All DCs"]);
        expect(runDetails("MTC", { selected: 5 })).toEqual(["5 selected"]);
    });

    it("an invoice download names which invoices", () => {
        expect(runDetails("Invoice", { invoiceType: "PO Invoices" })).toEqual(["PO Invoices"]);
        expect(runDetails("Invoice", {})).toEqual(["All Invoices"]);
        expect(runDetails("Invoice", { selected: 3, invoiceType: "WO Invoices" })).toEqual(["3 selected", "WO Invoices"]);
    });
});

describe("the window follows the job", () => {
    it("starts queued, with no total until the job starts", () => {
        const run = queued();
        expect(run.status).toBe("queued");
        expect(run.total).toBeNull();
        expect(isWorking(run.status)).toBe(true);
        expect(runTitle(run)).toBe("Downloading Procurement Orders");
    });

    it("counts finished documents and names the PO starting now", () => {
        let run = applyProgress(queued(), { done: 0, total: 34, current: "PO/001" }, 1_000);
        expect(run).toMatchObject({ status: "preparing", done: 0, total: 34, current: "PO/001", startedAt: 1_000 });
        run = applyProgress(run, { done: 12, total: 34, current: "PO/013" }, 61_000);
        expect(run).toMatchObject({ done: 12, current: "PO/013", startedAt: 1_000, updatedAt: 61_000 });
    });

    it("an older worker's event (no counts) still moves it on, with no total to show", () => {
        const run = applyProgress(queued(), { progress: 50, message: "Processing PO 2 of 4..." }, 1_000);
        expect(run).toMatchObject({ status: "preparing", total: null });
    });

    it("merging shows every document done and nobody current", () => {
        const preparing = applyProgress(queued(), { done: 33, total: 34, current: "PO/034" }, 1_000);
        const run = applyProgress(preparing, { stage: "merging", done: 34, total: 34 }, 2_000);
        expect(run).toMatchObject({ status: "merging", done: 34, total: 34, current: null });
    });

    it("a finished window ignores a late progress event", () => {
        const ready = applyReady(queued(), { token: "t", filename: "f.pdf", included: 2, total: 2 });
        expect(applyProgress(ready, { done: 1, total: 2 }, 5_000)).toBe(ready);
        const failed = applyFailed(queued(), { message: "No PO items found." });
        expect(applyProgress(failed, { done: 1, total: 2 }, 5_000)).toBe(failed);
    });
});

describe("the outcome", () => {
    it("a complete file reads 'ready'", () => {
        const run = applyReady(queued(), { token: "t", filename: "Tower_All_POs.pdf", included: 34, total: 34 });
        expect(run).toMatchObject({ status: "ready", filename: "Tower_All_POs.pdf", included: 34 });
        expect(missingCount(run)).toBe(0);
        expect(runTitle(run)).toBe("Procurement Orders ready");
        expect(isWorking(run.status)).toBe(false);
    });

    it("a file missing documents says how many", () => {
        const run = applyReady(queued(), { token: "t", filename: "f.pdf", included: 33, total: 34 });
        expect(missingCount(run)).toBe(1);
        expect(runTitle(run)).toBe("Procurement Orders ready, 1 missing");
    });

    it("an older worker's file (no counts) is not called incomplete", () => {
        const run = applyReady(queued(), { token: "t", filename: "f.pdf" });
        expect(missingCount(run)).toBe(0);
        expect(runTitle(run)).toBe("Procurement Orders ready");
    });

    it("a failure keeps the server's reason, or a plain sentence", () => {
        expect(applyFailed(queued(), { message: "No PO items found." })).toMatchObject({ status: "failed", error: "No PO items found." });
        expect(applyFailed(queued(), {}).error).toBe("The download failed. Please try again.");
        expect(runTitle(applyFailed(queued(), {}))).toBe("Download failed");
    });
});

describe("time left", () => {
    const at = (done: number, elapsedMs: number) =>
        applyProgress(applyProgress(queued(), { done: 0, total: 34 }, 0), { done, total: 34 }, elapsedMs);

    it("waits for three finished documents", () => {
        expect(timeLeft(at(2, 10_000))).toBeNull();
    });

    it("projects the pace so far onto what is left", () => {
        expect(timeLeft(at(12, 60_000))).toBe("About 2 min left"); // 5 s each, 22 left = 110 s
        expect(timeLeft(at(30, 30_000))).toBe("Less than a minute left");
    });

    it("is not shown while merging", () => {
        expect(timeLeft(applyProgress(at(12, 60_000), { stage: "merging", done: 34, total: 34 }, 70_000))).toBeNull();
    });
});

it("counts files for uploaded attachments and documents for rendered ones", () => {
    expect(unitNoun("DC", 1)).toBe("file");
    expect(unitNoun("Invoice", 3)).toBe("files");
    expect(unitNoun("PO", 34)).toBe("documents");
    expect(unitNoun("POPaymentVoucher", 1)).toBe("document");
});
