// @vitest-environment jsdom
//
// Two defects of the Bulk Download job lifecycle, on the side that broke:
//
//  1. A FAILED DOWNLOAD NEVER SHOWS "Download Complete!". The failure listener ran the `stopProgress`
//     of the render in which Download was clicked; that closure still held the previous download's
//     `progress === 100`, so a failure after an earlier success jumped to the Done step and dropped
//     the selection. Only a delivered file means done.
//  2. A REFUSED START SHOWS THE SERVER'S REASON. Frappe puts it in `_server_messages` / `exception`,
//     never in `message`, so every refusal read "Internal error" (wizard) or a bare status (Quick
//     Download).
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BulkDocType, BulkDownloadScope } from "@/utils/bulkDownload/bulkDownloadTypes";
import { useBulkPdfDownload } from "@/hooks/useBulkPdfDownload";
import { useBulkDownloadWizard } from "./useBulkDownloadWizard";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Handlers = {
    onProgress: (d: { progress?: number; message?: string }) => void;
    onReady: (d: { token: string; filename: string }) => void;
    onFailed: (d: { message: string }) => void;
};
const h = vi.hoisted(() => ({
    toast: vi.fn(), cancel: vi.fn(), handlers: null as Handlers | null,
    /** Doctype -> rows the list hook returns (when the wizard asks for that list at all). */
    lists: {} as Record<string, unknown[]>,
}));

vi.mock("@/components/ui/use-toast", () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock("@/hooks/useUserData", () => ({ useUserData: () => ({ role: "Nirmaan Admin Profile" }) }));
vi.mock("frappe-react-sdk", async () => {
    const { createContext } = await import("react");
    return {
        FrappeContext: createContext({ socket: {} }),
        useFrappeGetDocList: (doctype: string, _args: unknown, key: unknown) => ({ data: key ? h.lists[doctype] : undefined, isLoading: false }),
        useFrappeGetCall: () => ({ data: undefined, isLoading: false }),
    };
});
vi.mock("@/pages/projects/data/critical-po/useCriticalPOQueries", () => ({
    useProjectPOTaskLinks: () => ({ taskPOMap: {}, isLoading: false }),
}));
vi.mock("@/pages/projects/CriticalPOTasks/utils", () => ({ attachLinkedPOs: (tasks: unknown) => tasks }));
vi.mock("@/utils/bulkDownload/bulkDownloadEvents", () => ({
    newDownloadId: () => "test-download-0001",
    listenForDownload: (_socket: unknown, _id: string, handlers: Handlers) => {
        h.handlers = handlers;
        return () => {};
    },
    cancelBulkDownload: h.cancel,
}));

const SCOPE: BulkDownloadScope = { kind: "vendor", id: "VEN-1", name: "Vendor One", vendorType: "Material & Service" };
const TYPES: BulkDocType[] = ["PO", "PaymentVoucher"];
const SERVER_REFUSAL = {
    exc_type: "ValidationError",
    _server_messages: JSON.stringify([JSON.stringify({ message: "Select at least one PO to download." })]),
};

const started = { ok: true, status: 200, json: async () => ({ message: "Job enqueued", download_id: "test-download-0001" }) };
const refused = (status: number, body: unknown) => ({ ok: false, status, json: async () => body });
const htmlPage = (status: number) => ({ ok: false, status, json: async () => { throw new SyntaxError("Unexpected token '<'"); } });

let wiz!: ReturnType<typeof useBulkDownloadWizard>;
let quick!: ReturnType<typeof useBulkPdfDownload>;
function Wizard() {
    wiz = useBulkDownloadWizard(SCOPE, TYPES);
    return null;
}
// Critical PO Tasks exist only inside a project.
const PROJECT_SCOPE: BulkDownloadScope = { kind: "project", id: "P-1", name: "Tower A" };
function ProjectWizard() {
    wiz = useBulkDownloadWizard(PROJECT_SCOPE, TYPES);
    return null;
}
function Quick() {
    quick = useBulkPdfDownload(SCOPE);
    return null;
}

let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;
let anchorClick: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
    h.toast.mockReset();
    h.cancel.mockReset();
    h.handlers = null;
    h.lists = {};
    fetchMock = vi.fn().mockResolvedValue(started);
    vi.stubGlobal("fetch", fetchMock);
    anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
});
afterEach(() => {
    act(() => root.unmount());
    container.remove();
    anchorClick.mockRestore();
    vi.unstubAllGlobals();
});

const mount = (Component: () => null) => act(() => root.render(<Component />));
const download = async (type: BulkDocType, ids: string[]) => {
    act(() => wiz.goToStep2(type));
    act(() => wiz.selectAll(ids));
    await act(() => wiz.handleDownload());
};

describe("the wizard's progress window", () => {
    it("a download that fails after an earlier success stays on the selection, never 'Download Complete!'", async () => {
        mount(Wizard);
        await download("PO", ["PO-1", "PO-2"]);
        act(() => h.handlers!.onProgress({ progress: 100, message: "Processing POs 2 of 2..." }));
        act(() => h.handlers!.onReady({ token: "tok-1", filename: "Vendor One_Selected_POs.pdf" }));
        expect(wiz.step).toBe(3);
        expect(anchorClick).toHaveBeenCalledTimes(1);

        act(() => wiz.resetToTypeSelection());
        await download("PaymentVoucher", ["PAY-1"]);
        act(() => h.handlers!.onFailed({ message: "The download failed. Please try again." }));

        expect(wiz.step).toBe(2);
        expect(wiz.selectedIds).toEqual(["PAY-1"]);
        expect(wiz.showProgress).toBe(false);
        expect(wiz.loading).toBe(false);
        expect(anchorClick).toHaveBeenCalledTimes(1);
        expect(h.toast).toHaveBeenLastCalledWith(expect.objectContaining({ title: "Failed", description: "The download failed. Please try again." }));
    });

    it("a first download that fails also stays on the selection", async () => {
        mount(Wizard);
        await download("PO", ["PO-1"]);
        act(() => h.handlers!.onFailed({ message: "No PO items found." }));
        expect(wiz.step).toBe(2);
        expect(wiz.selectedIds).toEqual(["PO-1"]);
        expect(wiz.showProgress).toBe(false);
    });

    it("the delivered file is what makes a download done, whatever progress last said", async () => {
        mount(Wizard);
        await download("PO", ["PO-1", "PO-2", "PO-3"]);
        act(() => h.handlers!.onProgress({ progress: 66 })); // the last progress event never arrived
        act(() => h.handlers!.onReady({ token: "tok-2", filename: "Vendor One_Selected_POs.pdf" }));
        expect(wiz.step).toBe(3);
        expect(wiz.downloadedCount).toBe(3);
        expect(wiz.showProgress).toBe(false);
        expect(anchorClick).toHaveBeenCalledTimes(1);
    });
});

describe("the Critical POs tab picks from the step's own list", () => {
    // PO-2 has no deliveries, so it has no delivery note: the DN step must never queue it.
    const POS = [
        { name: "PO-1", status: "Delivered" },
        { name: "PO-2", status: "PO Approved" },
        { name: "PO-3", status: "Partially Delivered" },
    ];
    const TASKS = [
        { name: "TASK-1", item_name: "Chiller", linked_pos: ["PO-1", "PO-2"] },
        { name: "TASK-2", item_name: "AHU", linked_pos: ["PO-2"] },
        { name: "TASK-3", item_name: "Cable", linked_pos: ["PO-3"] },
    ];
    beforeEach(() => {
        h.lists = { "Procurement Orders": POS, "Critical PO Tasks": TASKS };
        mount(ProjectWizard);
    });

    it("PO step: a task queues every one of its POs", () => {
        act(() => wiz.goToStep2("PO"));
        act(() => wiz.selectMultipleCriticalTaskPOs(["TASK-1", "TASK-2"]));
        expect(wiz.selectedIds).toEqual(["PO-1", "PO-2"]);
    });

    it("DN step: a task queues only its POs that have deliveries", () => {
        act(() => wiz.goToStep2("DN"));
        act(() => wiz.selectMultipleCriticalTaskPOs(["TASK-1"]));
        expect(wiz.selectedIds).toEqual(["PO-1"]);
        act(() => wiz.selectMultipleCriticalTaskPOs(["TASK-1", "TASK-2", "TASK-3"]));
        expect(wiz.selectedIds).toEqual(["PO-1", "PO-3"]);
    });

    it("DN step's tasks show only POs with deliveries, so a task's chips and count match what it queues", () => {
        expect(wiz.dnCriticalTasks.map((t) => [t.name, t.linked_pos])).toEqual([
            ["TASK-1", ["PO-1"]],
            ["TASK-2", []], // no delivered PO: the tab hides it, as it hides tasks with no POs
            ["TASK-3", ["PO-3"]],
        ]);
        expect(wiz.criticalTasks.map((t) => t.linked_pos)).toEqual([["PO-1", "PO-2"], ["PO-2"], ["PO-3"]]);
    });
});

describe("a refused start shows the server's reason", () => {
    it("wizard: the server's message, not 'Internal error'", async () => {
        mount(Wizard);
        fetchMock.mockResolvedValueOnce(refused(417, SERVER_REFUSAL));
        await download("PO", ["PO-1"]);
        expect(h.toast).toHaveBeenLastCalledWith(expect.objectContaining({ title: "Error", description: "Select at least one PO to download." }));
        expect(wiz.showProgress).toBe(false);
        expect(wiz.loading).toBe(false);
    });

    it("wizard: an HTML error page (server restarting) gives a plain sentence, not a JSON parse error", async () => {
        mount(Wizard);
        fetchMock.mockResolvedValueOnce(htmlPage(502));
        await download("PO", ["PO-1"]);
        const { description } = h.toast.mock.lastCall![0];
        expect(description).toContain("502");
        expect(description).not.toMatch(/Unexpected token|Internal error/);
    });

    it("Quick Download: the server's message, not a bare status code", async () => {
        mount(Quick);
        fetchMock.mockResolvedValueOnce(refused(417, SERVER_REFUSAL));
        await act(() => quick.handleBulkDownload("DC", "Delivery Challans"));
        expect(h.toast).toHaveBeenLastCalledWith(expect.objectContaining({ title: "Error", description: "Select at least one PO to download." }));
        expect(quick.showProgress).toBe(false);
    });
});
