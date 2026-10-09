import { describe, expect, it, vi } from "vitest";
import { BULK_DOWNLOAD_EVENTS, BulkDownloadSocket, cancelBulkDownload, listenForDownload, newDownloadId } from "./bulkDownloadEvents";

/** A Socket.IO stand-in: listeners per event, removable one by one, and `emit` to fire them. */
const fakeSocket = () => {
    const listeners = new Map<string, Set<(data: any) => void>>();
    const socket: BulkDownloadSocket & { emit: (event: string, data: unknown) => void; count: () => number } = {
        on: (event, fn) => { (listeners.get(event) ?? listeners.set(event, new Set()).get(event)!).add(fn); },
        off: (event, fn) => { listeners.get(event)?.delete(fn); },
        emit: (event, data) => listeners.get(event)?.forEach((fn) => fn(data)),
        count: () => [...listeners.values()].reduce((n, set) => n + set.size, 0),
    };
    return socket;
};

const handlers = () => ({ onProgress: vi.fn(), onReady: vi.fn(), onFailed: vi.fn() });

describe("newDownloadId", () => {
    it("makes an id the server accepts (DOWNLOAD_ID_RE), different every time", () => {
        const a = newDownloadId();
        const b = newDownloadId();
        expect(a).toMatch(/^[A-Za-z0-9-]{8,64}$/);
        expect(a).not.toBe(b);
    });
});

describe("listenForDownload — two downloads of one user at once (project tab + vendor tab)", () => {
    it("hands each download only its own progress, file and failure", () => {
        const socket = fakeSocket();
        const project = handlers();
        const vendor = handlers();
        listenForDownload(socket, "project-download-1", project);
        listenForDownload(socket, "vendor-download-2", vendor);

        socket.emit(BULK_DOWNLOAD_EVENTS.progress, { download_id: "project-download-1", progress: 50 });
        socket.emit(BULK_DOWNLOAD_EVENTS.ready, { download_id: "project-download-1", token: "t1", filename: "p.pdf" });
        socket.emit(BULK_DOWNLOAD_EVENTS.failed, { download_id: "vendor-download-2", message: "boom" });

        expect(project.onProgress).toHaveBeenCalledOnce();
        expect(project.onReady).toHaveBeenCalledWith(expect.objectContaining({ token: "t1" }));
        expect(project.onFailed).not.toHaveBeenCalled();
        expect(vendor.onReady).not.toHaveBeenCalled();
        expect(vendor.onFailed).toHaveBeenCalledWith(expect.objectContaining({ message: "boom" }));
    });

    it("ignores events that carry no download id at all", () => {
        const socket = fakeSocket();
        const h = handlers();
        listenForDownload(socket, "only-mine-123", h);
        socket.emit(BULK_DOWNLOAD_EVENTS.ready, { token: "t", filename: "x.pdf" });
        expect(h.onReady).not.toHaveBeenCalled();
    });

    it("removes exactly its own listeners: the other download keeps hearing its events", () => {
        const socket = fakeSocket();
        const first = handlers();
        const second = handlers();
        const stopFirst = listenForDownload(socket, "first-download", first);
        listenForDownload(socket, "second-download", second);
        expect(socket.count()).toBe(6);

        stopFirst();
        expect(socket.count()).toBe(3);
        socket.emit(BULK_DOWNLOAD_EVENTS.ready, { download_id: "second-download", token: "t2", filename: "v.pdf" });
        socket.emit(BULK_DOWNLOAD_EVENTS.ready, { download_id: "first-download", token: "t1", filename: "p.pdf" });
        expect(second.onReady).toHaveBeenCalledOnce();
        expect(first.onReady).not.toHaveBeenCalled();
    });
});

describe("cancelBulkDownload — what the progress window's Cancel sends", () => {
    it("POSTs this download's id to cancel_bulk_download with the CSRF token (the server takes POST only)", async () => {
        const fetchMock = vi.fn().mockResolvedValue({ ok: true });
        vi.stubGlobal("fetch", fetchMock);
        vi.stubGlobal("window", { csrf_token: "csrf-123" });
        try {
            await cancelBulkDownload("abc12345-def6");
            const [url, init] = fetchMock.mock.calls[0];
            expect(url).toBe("/api/method/nirmaan_stack.api.pdf_helper.bulk_download.cancel_bulk_download");
            expect(init.method).toBe("POST");
            expect(init.headers).toEqual({ "X-Frappe-CSRF-Token": "csrf-123" });
            expect((init.body as FormData).get("download_id")).toBe("abc12345-def6");
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it("never throws when the request fails: the window has already closed", async () => {
        vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
        vi.stubGlobal("window", {});
        try {
            await expect(cancelBulkDownload("abc12345-def6")).resolves.toBeUndefined();
        } finally {
            vi.unstubAllGlobals();
        }
    });
});
