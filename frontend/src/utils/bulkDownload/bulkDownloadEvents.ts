/**
 * One bulk download's events -- shared by the Quick Download button and the wizard.
 *
 * The server publishes progress / ready / failed to EVERY open tab of the user. Each download
 * therefore carries its own id: the browser makes it before posting (so not even a very fast job
 * can announce itself before the tab knows the id), the server stamps it on every event, and a
 * tab reacts only to its own. Listeners are removed one by one -- never `socket.off(event)`, which
 * would also drop the other download's listeners on the same page.
 */

export const BULK_DOWNLOAD_EVENTS = {
    progress: "bulk_download_progress",
    ready: "bulk_download_all_ready",
    failed: "bulk_download_failed",
} as const;

const CANCEL_ENDPOINT = "/api/method/nirmaan_stack.api.pdf_helper.bulk_download.cancel_bulk_download";

/** The slice of a Socket.IO client this module uses. */
export interface BulkDownloadSocket {
    on(event: string, listener: (data: any) => void): unknown;
    off(event: string, listener: (data: any) => void): unknown;
}

export interface BulkDownloadHandlers {
    onProgress: (data: { progress?: number; message?: string }) => void;
    onReady: (data: { token: string; filename: string }) => void;
    onFailed: (data: { message?: string }) => void;
}

/** A fresh id for one download; matches the server's `DOWNLOAD_ID_RE` (`[A-Za-z0-9-]{8,64}`). */
export const newDownloadId = (): string =>
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

/** Listen for ONE download's events. Returns the function that removes exactly these listeners. */
export const listenForDownload = (
    socket: BulkDownloadSocket,
    downloadId: string,
    handlers: BulkDownloadHandlers,
): (() => void) => {
    const own = <T,>(fn: (data: T) => void) => (data: any) => {
        if (data?.download_id === downloadId) fn(data);
    };
    const bound: [string, (data: any) => void][] = [
        [BULK_DOWNLOAD_EVENTS.progress, own(handlers.onProgress)],
        [BULK_DOWNLOAD_EVENTS.ready, own(handlers.onReady)],
        [BULK_DOWNLOAD_EVENTS.failed, own(handlers.onFailed)],
    ];
    bound.forEach(([event, listener]) => socket.on(event, listener));
    return () => bound.forEach(([event, listener]) => socket.off(event, listener));
};

/** Ask the server to stop one of this user's downloads. Best effort: the window has already closed. */
export const cancelBulkDownload = (downloadId: string): Promise<unknown> => {
    const body = new FormData();
    body.append("download_id", downloadId);
    return fetch(CANCEL_ENDPOINT, {
        method: "POST",
        headers: { "X-Frappe-CSRF-Token": (window as any).csrf_token || "" },
        body,
    }).catch(() => undefined);
};
