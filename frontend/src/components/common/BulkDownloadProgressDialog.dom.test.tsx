// @vitest-environment jsdom
//
// The progress window in each state: what it says, which button it offers, and when it closes itself.
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BulkDownloadProgressDialog } from "./BulkDownloadProgressDialog";
import { DownloadRun, applyFailed, applyProgress, applyReady, startRun } from "@/utils/bulkDownload/bulkDownloadRun";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const onCancel = vi.fn();
const onClose = vi.fn();

beforeEach(() => {
    vi.useFakeTimers();
    onCancel.mockReset();
    onClose.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
});
afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
});

const show = (run: DownloadRun | null) =>
    act(() => root.render(<BulkDownloadProgressDialog run={run} scopeName="Tower A" onCancel={onCancel} onClose={onClose} />));
/** The dialog renders into a portal on document.body. */
const text = () => document.body.textContent ?? "";
const buttons = () => Array.from(document.body.querySelectorAll("button")).map((b) => b.textContent?.trim());

const queued = () => startRun("PO", ["All POs", "With rate"]);
const preparing = () => applyProgress(applyProgress(queued(), { done: 0, total: 34, current: "PO/001" }, 0), { done: 12, total: 34, current: "PO/013" }, 60_000);

describe("while the job runs", () => {
    it("names the download, counts finished documents and offers only Cancel", () => {
        show(preparing());
        expect(text()).toContain("Downloading Procurement Orders");
        expect(text()).toContain("Tower A · All POs · With rate");
        expect(text()).toContain("12 of 34 documents");
        expect(text()).toContain("35%");
        expect(text()).toContain("PO/013");
        expect(text()).toContain("About 2 min left");
        expect(text()).toContain("Keep this page open until the file downloads.");
        expect(buttons()).toEqual(["Cancel download"]); // no ✕, no Close, no background button
        expect(text()).not.toMatch(/Queued|Merging/); // no stepper
    });

    it("Cancel calls back", () => {
        show(preparing());
        act(() => (document.body.querySelector("button") as HTMLButtonElement).click());
        expect(onCancel).toHaveBeenCalledOnce();
    });

    it("says when it is still waiting for the server, and why after a while", () => {
        show(queued());
        expect(text()).toContain("Waiting for the server to start…");
        act(() => vi.advanceTimersByTime(10_000));
        expect(text()).toContain("Other downloads are running. Yours will start automatically.");
    });

    it("says it is combining the file", () => {
        show(applyProgress(preparing(), { stage: "merging", done: 34, total: 34 }, 70_000));
        expect(text()).toContain("Combining 34 documents into one PDF…");
        expect(text()).not.toContain("min left");
    });
});

describe("the outcome", () => {
    it("a complete file shows its name and closes itself after 2 s", () => {
        show(applyReady(preparing(), { token: "t", filename: "Tower_A_All_POs.pdf", included: 34, total: 34 }));
        expect(text()).toContain("Procurement Orders ready");
        expect(text()).toContain("Tower_A_All_POs.pdf · downloading");
        expect(buttons()).toEqual(["Close"]);
        act(() => vi.advanceTimersByTime(1_999));
        expect(onClose).not.toHaveBeenCalled();
        act(() => vi.advanceTimersByTime(1));
        expect(onClose).toHaveBeenCalledOnce();
    });

    it("a file missing documents says so and waits to be closed", () => {
        show(applyReady(preparing(), { token: "t", filename: "f.pdf", included: 33, total: 34 }));
        expect(text()).toContain("Procurement Orders ready, 1 missing");
        expect(text()).toContain("33 of 34 documents included");
        expect(text()).toContain("1 document could not be added.");
        act(() => vi.advanceTimersByTime(10_000));
        expect(onClose).not.toHaveBeenCalled();
    });

    it("a failure shows the server's reason with Close", () => {
        show(applyFailed(queued(), { message: "No PO items found." }));
        expect(text()).toContain("Download failed");
        expect(text()).toContain("No PO items found.");
        expect(buttons()).toEqual(["Close"]);
        act(() => (document.body.querySelector("button") as HTMLButtonElement).click());
        expect(onClose).toHaveBeenCalledOnce();
    });
});

it("renders nothing without a download", () => {
    show(null);
    expect(document.body.querySelector("[role=dialog]")).toBeNull();
});
