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
import type { BulkDownloadHandlers } from "@/utils/bulkDownload/bulkDownloadEvents";
import { useBulkPdfDownload } from "@/hooks/useBulkPdfDownload";
import { useBulkDownloadWizard } from "./useBulkDownloadWizard";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Handlers = BulkDownloadHandlers;
const h = vi.hoisted(() => ({
    toast: vi.fn(), cancel: vi.fn(), handlers: null as Handlers | null,
    /** Doctype -> rows the list hook returns (when the wizard asks for that list at all), or a
     *  function of the query when one doctype backs two lists (PO / WO payments). */
    lists: {} as Record<string, unknown[] | ((args: { filters: unknown[] }) => unknown[])>,
    /** Every list query the wizard made: doctype + its arguments. */
    queries: [] as { doctype: string; args: { filters: unknown[] }; key: unknown }[],
}));

vi.mock("@/components/ui/use-toast", () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock("@/hooks/useUserData", () => ({ useUserData: () => ({ role: "Nirmaan Admin Profile" }) }));
vi.mock("frappe-react-sdk", async () => {
    const { createContext } = await import("react");
    return {
        FrappeContext: createContext({ socket: {} }),
        useFrappeGetDocList: (doctype: string, args: { filters: unknown[] }, key: unknown) => {
            h.queries.push({ doctype, args, key });
            const rows = h.lists[doctype];
            return { data: key ? (typeof rows === "function" ? rows(args) : rows) : undefined, isLoading: false };
        },
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
        // Removing the listeners: no later event reaches this download any more.
        return () => { if (h.handlers === handlers) h.handlers = null; };
    },
    cancelBulkDownload: h.cancel,
}));

const SCOPE: BulkDownloadScope = { kind: "vendor", id: "VEN-1", name: "Vendor One", vendorType: "Material & Service" };
const TYPES: BulkDocType[] = ["PO", "POPaymentVoucher", "WOPaymentVoucher"];
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
    h.queries = [];
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
        await download("WOPaymentVoucher", ["PAY-1"]);
        act(() => h.handlers!.onFailed({ message: "The download failed. Please try again." }));

        expect(wiz.step).toBe(2);
        expect(wiz.selectedIds).toEqual(["PAY-1"]);
        expect(wiz.showProgress).toBe(false);
        expect(wiz.loading).toBe(false);
        expect(anchorClick).toHaveBeenCalledTimes(1);
        // The window stays open on the reason (no toast on top of it).
        expect(wiz.run).toMatchObject({ status: "failed", error: "The download failed. Please try again." });
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

    it("follows the job from queued to the file, and Done counts what the file holds", async () => {
        mount(Wizard);
        await download("PO", ["PO-1", "PO-2", "PO-3"]);
        expect(wiz.run).toMatchObject({ status: "queued", type: "PO", details: ["3 selected", "With rate"] });
        expect(wiz.showProgress).toBe(true);

        act(() => h.handlers!.onProgress({ done: 0, total: 3, current: "PO-1" }));
        expect(wiz.run).toMatchObject({ status: "preparing", done: 0, total: 3, current: "PO-1" });
        act(() => h.handlers!.onProgress({ stage: "merging", done: 3, total: 3 }));
        expect(wiz.run?.status).toBe("merging");

        act(() => h.handlers!.onReady({ token: "tok-4", filename: "Vendor One_Selected_POs.pdf", included: 2, total: 3 }));
        expect(wiz.run).toMatchObject({ status: "ready", included: 2, total: 3 });
        expect(wiz.showProgress).toBe(false); // the job is over; the window shows the outcome
        expect(wiz.downloadedCount).toBe(2);
        expect(anchorClick).toHaveBeenCalledTimes(1);

        act(() => wiz.closeProgress());
        expect(wiz.run).toBeNull();
    });

    it("never toasts that it started: the window already shows it", async () => {
        mount(Wizard);
        await download("PO", ["PO-1"]);
        expect(h.toast).not.toHaveBeenCalled();
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

describe("payment vouchers", () => {
    // One doctype backs both lists: the query's document_type says which one is asked for.
    const PO_PAYMENTS = [
        { name: "PAY-P1", document_name: "PO-1", status: "Paid", payment_date: "2026-09-01" },
        { name: "PAY-P3", document_name: "PO-2", status: "Paid", payment_date: "2026-09-03" },
    ];
    const WO_PAYMENTS = [{ name: "PAY-W1", document_name: "SR-1", status: "Paid", voucher_attachment: "/files/v.pdf" }];
    const isFor = (args: { filters: unknown[] }, documentType: string) =>
        args.filters.some((f) => JSON.stringify(f) === JSON.stringify(["document_type", "=", documentType]));
    const lastQuery = (documentType: string) =>
        [...h.queries].reverse().find((q) => q.doctype === "Project Payments" && isFor(q.args, documentType))!;
    beforeEach(() => {
        h.lists = { "Project Payments": (args) => (isFor(args, "Procurement Orders") ? PO_PAYMENTS : WO_PAYMENTS) };
        mount(Wizard);
    });

    it("PO: asks only for Paid PO payments (a voucher exists only for a payment made), and the card counts them", () => {
        expect(lastQuery("Procurement Orders").args.filters).toContainEqual(["status", "=", "Paid"]);
        expect(wiz.poVoucherPayments.map((p) => p.name)).toEqual(["PAY-P1", "PAY-P3"]);
        expect(wiz.itemCounts.POPaymentVoucher).toBe(2);
    });

    it("WO: asks only for paid payments that have an uploaded voucher (no 'Missing' rows)", () => {
        const { filters } = lastQuery("Service Requests").args;
        expect(filters).toContainEqual(["status", "=", "Paid"]);
        expect(filters).toContainEqual(["voucher_attachment", "is", "set"]);
        expect(wiz.itemCounts.WOPaymentVoucher).toBe(1);
    });

    it("PO: Download posts the payment names to the PO voucher endpoint; Done names the kind", async () => {
        await download("POPaymentVoucher", ["PAY-P1", "PAY-P3"]);
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toMatch(/bulk_download\.download_selected_po_payment_vouchers$/);
        expect((init.body as FormData).get("names")).toBe(JSON.stringify(["PAY-P1", "PAY-P3"]));
        expect((init.body as FormData).get("vendor")).toBe("VEN-1");
        act(() => h.handlers!.onReady({ token: "tok-4", filename: "Vendor One_Selected_PO_Payment_Vouchers.pdf" }));
        expect(wiz.downloadedLabel).toBe("PO Payment Voucher");
    });

    it("WO: Download posts to the WO voucher endpoint", async () => {
        await download("WOPaymentVoucher", ["PAY-W1"]);
        expect(fetchMock.mock.calls[0][0]).toMatch(/bulk_download\.download_selected_wo_payment_vouchers$/);
    });

    it("Quick Download: 'all' asks the server for each kind by its own doc type", async () => {
        mount(Quick);
        await act(() => quick.handleBulkDownload("POPaymentVoucher", "PO Payment Vouchers"));
        await act(() => quick.handleBulkDownload("WOPaymentVoucher", "WO Payment Vouchers"));
        const sent = fetchMock.mock.calls.map(([url, init]) => [String(url).split(".").pop(), (init.body as FormData).get("doc_type")]);
        expect(sent).toEqual([["download_project_attachments", "PO Payment Vouchers"], ["download_project_attachments", "WO Payment Vouchers"]]);
    });

    it("Quick Download: the window names what it downloads", async () => {
        mount(Quick);
        await act(() => quick.handleBulkDownload("PO", "POs", { withRate: false }));
        expect(quick.run).toMatchObject({ status: "queued", type: "PO", details: ["All POs", "Without rate"] });
        await act(() => quick.handleBulkDownload("Invoice", "Invoices", { invoiceType: "WO Invoices" }));
        expect(quick.run?.details).toEqual(["WO Invoices"]);
    });
});

describe("Cancel download", () => {
    it("tells the server to stop THIS download, stops listening, and keeps the selection", async () => {
        mount(Wizard);
        await download("PO", ["PO-1", "PO-2"]);
        act(() => h.handlers!.onProgress({ progress: 20, message: "Processing PO 1 of 5..." }));
        act(() => wiz.cancelDownload());

        expect(h.cancel).toHaveBeenCalledOnce();
        expect(h.cancel).toHaveBeenCalledWith("test-download-0001");
        expect(h.handlers).toBeNull(); // a late file or failure can no longer reach the page
        expect(wiz.showProgress).toBe(false);
        expect(wiz.run).toBeNull(); // Cancel closes the window outright
        expect(wiz.loading).toBe(false);
        expect(wiz.step).toBe(2);
        expect(wiz.selectedIds).toEqual(["PO-1", "PO-2"]);
        expect(anchorClick).not.toHaveBeenCalled();
        expect(h.toast).toHaveBeenLastCalledWith(expect.objectContaining({ title: "Download cancelled" }));
    });

    it("leaving the page mid-download cancels it on the server too", async () => {
        mount(Wizard);
        await download("PO", ["PO-1"]);
        act(() => root.unmount());
        root = createRoot(container); // afterEach unmounts a live root
        expect(h.cancel).toHaveBeenCalledWith("test-download-0001");
    });

    it("leaving the page after the file arrived cancels nothing", async () => {
        mount(Wizard);
        await download("PO", ["PO-1"]);
        act(() => h.handlers!.onReady({ token: "tok-3", filename: "Vendor One_Selected_POs.pdf" }));
        act(() => root.unmount());
        root = createRoot(container);
        expect(h.cancel).not.toHaveBeenCalled();
    });

    it("Quick Download: Cancel stops its own download the same way", async () => {
        mount(Quick);
        await act(() => quick.handleBulkDownload("DC", "Delivery Challans"));
        act(() => quick.cancelDownload());
        expect(h.cancel).toHaveBeenCalledWith("test-download-0001");
        expect(h.handlers).toBeNull();
        expect(quick.showProgress).toBe(false);
        expect(quick.loading).toBe(false);
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
