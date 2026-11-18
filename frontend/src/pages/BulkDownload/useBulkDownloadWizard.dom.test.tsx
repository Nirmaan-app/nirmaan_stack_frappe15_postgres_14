// @vitest-environment jsdom
//
// The Bulk Download screens (Quick Download and the wizard) follow each download as a background operation
// (ADR 0047, #1664), through the real shared hook. Only the server is faked: `fetch` answers the start endpoint,
// the status read and the file collect, and a fake socket sends the "read now" message.
//
// What this pins, on the side that broke before:
//  1. A FAILED DOWNLOAD NEVER SHOWS "Download Complete!". Only a delivered file means done; a failure after an
//     earlier success keeps the selection.
//  2. A REFUSED START SHOWS THE SERVER'S REASON (`_server_messages` / `exception`), never "Internal error" or a
//     bare status.
//  3. A DOWNLOAD IS ITS OWN OPERATION: the window reads its own record, the file is collected by its id, Cancel
//     stops only it, and leaving the page keeps it (coming back picks it up again).
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BulkDocType, BulkDownloadScope } from "@/utils/bulkDownload/bulkDownloadTypes";
import { useBulkPdfDownload } from "@/hooks/useBulkPdfDownload";
import { parseJson } from "@/lib/parseJson";
import { useBulkDownloadWizard } from "./useBulkDownloadWizard";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => {
    const listeners = new Map<string, Set<(data: unknown) => void>>();
    return {
        toast: vi.fn(),
        /** The socket the screens listen on: `emit` delivers a message to every listener of the event. */
        socket: {
            connected: true,
            on: (event: string, fn: (data: unknown) => void) => void (listeners.get(event) ?? listeners.set(event, new Set()).get(event)!).add(fn),
            off: (event: string, fn: (data: unknown) => void) => void listeners.get(event)?.delete(fn),
            emit: (event: string, data: unknown) => listeners.get(event)?.forEach((fn) => fn(data)),
        },
        /** Doctype -> rows the list hook returns (when the wizard asks for that list at all), or a
         *  function of the query when one doctype backs two lists (PO / WO payments). */
        lists: {} as Record<string, unknown[] | ((args: { filters: unknown[] }) => unknown[])>,
        /** Every list query the wizard made: doctype + its arguments. */
        queries: [] as { doctype: string; args: { filters: unknown[] }; key: unknown }[],
        /** Every server call the wizard made (method + SWR key; a null key fetches nothing). */
        calls: [] as { method: string; key: unknown }[],
    };
});

vi.mock("@/components/ui/use-toast", () => ({ useToast: () => ({ toast: h.toast }), toast: h.toast }));
vi.mock("@/hooks/useUserData", () => ({ useUserData: () => ({ role: "Nirmaan Admin Profile" }) }));
// The shared background-operation hook reads the socket from here.
vi.mock("@/lib/frappe", async () => {
    const { createContext } = await import("react");
    return { FrappeContext: createContext({ socket: h.socket }) };
});
vi.mock("frappe-react-sdk", () => ({
    useFrappeGetDocList: (doctype: string, args: { filters: unknown[] }, key: unknown) => {
        h.queries.push({ doctype, args, key });
        const rows = h.lists[doctype];
        return { data: key ? (typeof rows === "function" ? rows(args) : rows) : undefined, isLoading: false };
    },
    useFrappeGetCall: (method: string, _args: unknown, key: unknown) => {
        h.calls.push({ method, key });
        return { data: undefined, isLoading: false };
    },
}));
vi.mock("@/pages/projects/data/critical-po/useCriticalPOQueries", () => ({
    useProjectPOTaskLinks: () => ({ taskPOMap: {}, isLoading: false }),
}));
vi.mock("@/pages/projects/CriticalPOTasks/utils", () => ({ attachLinkedPOs: (tasks: unknown) => tasks }));

const SCOPE: BulkDownloadScope = { kind: "vendor", id: "VEN-1", name: "Vendor One", vendorType: "Material & Service" };
const TYPES: BulkDocType[] = ["PO", "POPaymentVoucher", "WOPaymentVoucher"];
const SERVER_REFUSAL = {
    exc_type: "ValidationError",
    _server_messages: JSON.stringify([JSON.stringify({ message: "Select at least one PO to download." })]),
};

/** A reply as `fetch` gives it. */
const reply = (status: number, body: unknown) => ({
    ok: status < 400,
    status,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
    blob: async () => new Blob(["%PDF-1.4"]),
});
const refused = (status: number, body: unknown) => reply(status, body);
const htmlPage = (status: number) => reply(status, "<html><body>Bad gateway</body></html>");

/** The fake server: what each operation's record says now, and every request the screens sent. */
let records: Map<string, Record<string, unknown>>;
let nextStart: ReturnType<typeof reply> | null;
let fetchMock: ReturnType<typeof vi.fn>;

const urlOf = (input: unknown) => String(input);
/** The start requests (a download endpoint), with their JSON bodies. */
const starts = () => fetchMock.mock.calls
    .filter(([url, init]) => (init as RequestInit | undefined)?.method === "POST" && /bulk_download\.download_/.test(urlOf(url)))
    .map(([url, init]) => ({ url: urlOf(url), body: parseJson(String((init as RequestInit).body)) as Record<string, unknown> }));
const cancels = () => fetchMock.mock.calls
    .filter(([url]) => urlOf(url).endsWith("cancel_bulk_download"))
    .map(([, init]) => ((init as RequestInit).body as FormData).get("op_id"));
const collects = () => fetchMock.mock.calls.filter(([url]) => urlOf(url).includes("background_ops.collect_result"));
const lastOpId = () => String(starts().at(-1)!.body.op_id);

function serve(input: unknown, init?: RequestInit) {
    const url = urlOf(input);
    if (/bulk_download\.download_/.test(url)) {
        const body = parseJson(String(init!.body)) as Record<string, unknown>;
        const opId = String(body.op_id);
        if (nextStart) {
            const refusal = nextStart;
            nextStart = null;
            return Promise.resolve(refusal);
        }
        records.set(opId, { op_id: opId, state: "queued", now: 1000 });
        return Promise.resolve(reply(200, { message: { op_id: opId, state: "queued" } }));
    }
    if (url.includes("background_ops.get_status")) {
        const opId = new URL(url, "http://x").searchParams.get("op_id")!;
        return Promise.resolve(reply(200, { message: records.get(opId) ?? { op_id: opId, state: "lost", error: "No record." } }));
    }
    return Promise.resolve(reply(200, { message: "ok" }));
}

/** The server moves the last download on, and tells the screen to read it now. */
const serverSays = async (record: Record<string, unknown>) => {
    const opId = lastOpId();
    records.set(opId, { op_id: opId, now: 1000, started_at: 1000, timeout: 1500, ...record });
    await act(async () => {
        h.socket.emit("background_op:read_now", { op_id: opId });
        for (let i = 0; i < 10; i += 1) await Promise.resolve();
    });
};
const progress = (detail: Record<string, unknown>) => serverSays({ state: "running", progress: { percent: 0, message: null, detail } });
const finished = (filename: string, counts: Record<string, unknown> = {}) =>
    serverSays({ state: "finished", result: { ...counts, file: { filename, size_bytes: 8 } } });
const failed = (error: string) => serverSays({ state: "failed", error });

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
let anchorClick: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
    h.toast.mockReset();
    h.lists = {};
    h.queries = [];
    h.calls = [];
    records = new Map();
    nextStart = null;
    window.sessionStorage.clear();
    fetchMock = vi.fn(serve);
    vi.stubGlobal("fetch", fetchMock);
    window.URL.createObjectURL = vi.fn(() => "blob:test");
    window.URL.revokeObjectURL = vi.fn();
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
        await progress({ done: 1, total: 2 });
        await finished("Vendor One_Selected_POs.pdf", { included: 2, total: 2 });
        expect(wiz.step).toBe(3);
        expect(anchorClick).toHaveBeenCalledTimes(1);

        act(() => wiz.closeProgress());
        act(() => wiz.resetToTypeSelection());
        await download("WOPaymentVoucher", ["PAY-1"]);
        await failed("The operation failed. The error has been logged.");

        expect(wiz.step).toBe(2);
        expect(wiz.selectedIds).toEqual(["PAY-1"]);
        expect(wiz.showProgress).toBe(false);
        expect(wiz.loading).toBe(false);
        expect(anchorClick).toHaveBeenCalledTimes(1);
        // The window stays open on the reason (no toast on top of it).
        expect(wiz.run).toMatchObject({ status: "failed", error: "The operation failed. The error has been logged." });
        expect(h.toast).not.toHaveBeenCalled();
    });

    it("a first download that fails also stays on the selection", async () => {
        mount(Wizard);
        await download("PO", ["PO-1"]);
        await failed("No PO items found.");
        expect(wiz.step).toBe(2);
        expect(wiz.selectedIds).toEqual(["PO-1"]);
        expect(wiz.showProgress).toBe(false);
    });

    it("follows its own operation from queued to the file, and Done counts what the file holds", async () => {
        mount(Wizard);
        await download("PO", ["PO-1", "PO-2", "PO-3"]);
        expect(starts()).toHaveLength(1);
        expect(wiz.run).toMatchObject({ status: "queued", type: "PO", details: ["3 selected", "With rate"] });
        expect(wiz.showProgress).toBe(true);

        // Another operation's message changes nothing.
        await act(async () => h.socket.emit("background_op:read_now", { op_id: "bbbbbbbb-0000-4000-8000-000000000002" }));
        expect(wiz.run?.status).toBe("queued");

        await progress({ done: 0, total: 3, current: "PO-1" });
        expect(wiz.run).toMatchObject({ status: "preparing", done: 0, total: 3, current: "PO-1" });
        await progress({ stage: "merging", done: 3, total: 3 });
        expect(wiz.run?.status).toBe("merging");

        await finished("Vendor One_Selected_POs.pdf", { included: 2, total: 3 });
        expect(wiz.run).toMatchObject({ status: "ready", included: 2, total: 3, filename: "Vendor One_Selected_POs.pdf" });
        expect(wiz.showProgress).toBe(false); // the download is over; the window shows the outcome
        expect(wiz.downloadedCount).toBe(2);
        // The file is collected by this operation's id, once.
        expect(collects()).toHaveLength(1);
        expect(urlOf(collects()[0][0])).toContain(`op_id=${lastOpId()}`);
        expect(anchorClick).toHaveBeenCalledTimes(1);

        act(() => wiz.closeProgress());
        expect(wiz.run).toBeNull();
    });

    it("never toasts that it started: the window already shows it", async () => {
        mount(Wizard);
        await download("PO", ["PO-1"]);
        expect(h.toast).not.toHaveBeenCalled();
    });

    it("leaving the page keeps the download, and coming back picks it up again", async () => {
        mount(Wizard);
        await download("PO", ["PO-1"]);
        act(() => root.unmount());
        root = createRoot(container);
        expect(cancels()).toEqual([]);

        await progress({ done: 0, total: 1, current: "PO-1" });
        mount(Wizard);
        await act(async () => { for (let i = 0; i < 10; i += 1) await Promise.resolve(); });
        expect(wiz.run).toMatchObject({ status: "preparing", type: "PO", details: ["1 selected", "With rate"] });
        await finished("Vendor One_Selected_POs.pdf", { included: 1, total: 1 });
        expect(anchorClick).toHaveBeenCalledTimes(1);
        expect(wiz.step).toBe(3);
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
        const [{ url, body }] = starts();
        expect(url).toMatch(/bulk_download\.download_selected_po_payment_vouchers$/);
        expect(body.names).toBe(JSON.stringify(["PAY-P1", "PAY-P3"]));
        expect(body.vendor).toBe("VEN-1");
        await finished("Vendor One_Selected_PO_Payment_Vouchers.pdf", { included: 2, total: 2 });
        expect(wiz.downloadedLabel).toBe("PO Payment Voucher");
    });

    it("WO: Download posts to the WO voucher endpoint", async () => {
        await download("WOPaymentVoucher", ["PAY-W1"]);
        expect(starts()[0].url).toMatch(/bulk_download\.download_selected_wo_payment_vouchers$/);
    });

    it("Quick Download: 'all' asks the server for each kind by its own doc type", async () => {
        mount(Quick);
        await act(() => quick.handleBulkDownload("POPaymentVoucher"));
        await act(() => quick.handleBulkDownload("WOPaymentVoucher"));
        const sent = starts().map(({ url, body }) => [url.split(".").pop(), body.doc_type]);
        expect(sent).toEqual([["download_project_attachments", "PO Payment Vouchers"], ["download_project_attachments", "WO Payment Vouchers"]]);
    });

    it("Quick Download: the window names what it downloads", async () => {
        mount(Quick);
        await act(() => quick.handleBulkDownload("PO", { withRate: false }));
        expect(quick.run).toMatchObject({ status: "queued", type: "PO", details: ["All POs", "Without rate"] });
        await act(() => quick.handleBulkDownload("Invoice", { invoiceType: "WO Invoices" }));
        expect(quick.run?.details).toEqual(["WO Invoices"]);
    });
});

describe("Cancel download", () => {
    it("tells the server to stop THIS download, stops following it, and keeps the selection", async () => {
        mount(Wizard);
        await download("PO", ["PO-1", "PO-2"]);
        await progress({ done: 1, total: 5, current: "PO-1" });
        const opId = lastOpId();
        act(() => wiz.cancelDownload());
        await act(async () => { for (let i = 0; i < 5; i += 1) await Promise.resolve(); });

        expect(cancels()).toEqual([opId]);
        expect(wiz.showProgress).toBe(false);
        expect(wiz.run).toBeNull(); // Cancel closes the window outright
        expect(wiz.loading).toBe(false);
        expect(wiz.step).toBe(2);
        expect(wiz.selectedIds).toEqual(["PO-1", "PO-2"]);
        expect(h.toast).toHaveBeenLastCalledWith(expect.objectContaining({ title: "Download cancelled" }));

        // A late file can no longer reach the page.
        await finished("Vendor One_Selected_POs.pdf", { included: 2, total: 2 });
        expect(anchorClick).not.toHaveBeenCalled();
        expect(wiz.run).toBeNull();
    });

    it("Quick Download: Cancel stops its own download the same way", async () => {
        mount(Quick);
        await act(() => quick.handleBulkDownload("DC"));
        const opId = lastOpId();
        act(() => quick.cancelDownload());
        expect(cancels()).toEqual([opId]);
        expect(quick.showProgress).toBe(false);
        expect(quick.loading).toBe(false);
    });
});

describe("a refused start shows the server's reason", () => {
    it("wizard: the server's message, not 'Internal error'", async () => {
        mount(Wizard);
        nextStart = refused(417, SERVER_REFUSAL);
        await download("PO", ["PO-1"]);
        expect(wiz.run).toMatchObject({ status: "failed", error: "Select at least one PO to download." });
        expect(wiz.showProgress).toBe(false);
        expect(wiz.loading).toBe(false);
    });

    it("wizard: an HTML error page (server restarting) gives a plain sentence, not a parse error", async () => {
        mount(Wizard);
        nextStart = htmlPage(502);
        await download("PO", ["PO-1"]);
        expect(wiz.run?.status).toBe("failed");
        expect(wiz.run?.error).not.toMatch(/Unexpected token|Internal error|<html/);
    });

    it("Quick Download: the server's message, not a bare status code", async () => {
        mount(Quick);
        nextStart = refused(417, SERVER_REFUSAL);
        await act(() => quick.handleBulkDownload("DC"));
        expect(quick.run).toMatchObject({ status: "failed", error: "Select at least one PO to download." });
        expect(quick.showProgress).toBe(false);
    });
});

describe("the all scope (Reports > Bulk Download: every project, no picker)", () => {
    const ALL_SCOPE: BulkDownloadScope = { kind: "all", id: "", name: "All projects" };
    const ALL_TYPES: BulkDocType[] = ["PO", "WO", "Invoice", "DC", "MIR", "DN", "MTC", "ClientInvoice", "POPaymentVoucher", "WOPaymentVoucher"];
    function AllWizard() {
        wiz = useBulkDownloadWizard(ALL_SCOPE, ALL_TYPES);
        return null;
    }
    /** The key of the LAST query the wizard made for a doctype (null = not fetched). */
    const lastKeys = () => {
        const keys: Record<string, unknown> = {};
        for (const q of h.queries) keys[`${q.doctype}:${JSON.stringify(q.args.filters.slice(-1))}`] = q.key;
        return keys;
    };
    const fetched = () => Object.entries(lastKeys()).filter(([, key]) => key).map(([k, key]) => [k.split(":")[0], key]);

    it("opening the tab fetches NO list (company-wide lists load only for the type opened)", () => {
        mount(AllWizard);
        expect(fetched()).toEqual([]);
    });

    it("opening a type fetches only its own list, with no project or vendor filter", () => {
        mount(AllWizard);
        act(() => wiz.goToStep2("PO"));
        expect(fetched()).toEqual([["Procurement Orders", "bulk-po-all"]]);
        const po = h.queries.filter((q) => q.doctype === "Procurement Orders").at(-1)!;
        expect(JSON.stringify(po.args.filters)).not.toMatch(/"(project|vendor)"/);
    });

    it("DN reads the same PO list (one request for both)", () => {
        mount(AllWizard);
        act(() => wiz.goToStep2("DN"));
        expect(fetched()).toEqual([["Procurement Orders", "bulk-po-all"]]);
    });

    it("client invoices are offered (a project type) and carry the project for the Project filter", () => {
        mount(AllWizard);
        act(() => wiz.goToStep2("ClientInvoice"));
        const pi = h.queries.filter((q) => q.doctype === "Project Invoices").at(-1)!;
        expect(pi.key).toBe("bulk-pi-all");
        expect((pi.args as unknown as { fields: string[] }).fields).toEqual(expect.arrayContaining(["project", "project.project_name"]));
    });

    it("Download posts all_scope=1 and no project or vendor", async () => {
        mount(AllWizard);
        await download("PO", ["PO-1", "PO-2"]);
        const [{ url, body }] = starts();
        expect(url).toContain("download_selected_pos");
        expect(body.all_scope).toBe(1);
        expect(body).not.toHaveProperty("project");
        expect(body).not.toHaveProperty("vendor");
        expect(body.names).toBe(JSON.stringify(["PO-1", "PO-2"]));
    });

    it("refuses more than 500 before asking the server; exactly 500 goes through", async () => {
        mount(AllWizard);
        await download("PO", Array.from({ length: 501 }, (_, i) => `PO-${i}`));
        expect(starts()).toHaveLength(0);
        expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Too many items" }));
        await download("PO", Array.from({ length: 500 }, (_, i) => `PO-${i}`));
        expect(starts()).toHaveLength(1);
    });

    it("a project scope still loads its lists up front and sends its project (unchanged)", async () => {
        mount(ProjectWizard);
        expect(fetched().map(([doctype]) => doctype)).toContain("Procurement Orders");
        await download("PO", ["PO-1"]);
        const [{ body }] = starts();
        expect(body.project).toBe("P-1");
        expect(body).not.toHaveProperty("all_scope");
    });
});

describe("Porter Invoices (Report Bulk Download only)", () => {
    const ALL_SCOPE: BulkDownloadScope = { kind: "all", id: "", name: "All projects" };
    const ALL_TYPES: BulkDocType[] = ["PO", "WO", "Invoice", "DC", "MIR", "DN", "MTC", "ClientInvoice", "POPaymentVoucher", "WOPaymentVoucher", "PorterInvoice"];
    function AllWizard() {
        wiz = useBulkDownloadWizard(ALL_SCOPE, ALL_TYPES);
        return null;
    }
    const porterKey = () => h.calls.filter((c) => c.method.endsWith("porter_invoices.get_porter_invoices")).at(-1)?.key;

    it("loads the Porter list only when its card is opened", () => {
        mount(AllWizard);
        expect(porterKey()).toBeNull();
        act(() => wiz.goToStep2("PO"));
        expect(porterKey()).toBeNull();
        act(() => wiz.goToStep2("PorterInvoice"));
        expect(porterKey()).toBe("bulk-porter-all");
    });

    it("never loads it on a project tab, even if asked for the type", () => {
        function ProjectPorter() {
            wiz = useBulkDownloadWizard(PROJECT_SCOPE, ["PO", "PorterInvoice"]);
            return null;
        }
        mount(ProjectPorter);
        act(() => wiz.goToStep2("PorterInvoice"));
        expect(porterKey()).toBeNull();
    });

    it("Download posts the invoice numbers (never file links) with all_scope", async () => {
        mount(AllWizard);
        await download("PorterInvoice", ["PRT-BLR-0412", "PRT-CHN-0091"]);
        const [{ url, body }] = starts();
        expect(url).toContain("bulk_download.download_selected_porter_invoices");
        expect(body.names).toBe(JSON.stringify(["PRT-BLR-0412", "PRT-CHN-0091"]));
        expect(body.all_scope).toBe(1);
        expect(body).not.toHaveProperty("attachment_names");
    });
});

