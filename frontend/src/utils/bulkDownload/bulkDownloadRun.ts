/**
 * One bulk download as the progress window shows it -- shared by the Quick Download button and the
 * wizard. Pure: the hooks feed it the server's events, the window renders it.
 */
import { BulkDocType, TYPE_INFO } from "./bulkDownloadTypes";
import type { BulkDownloadProgressEvent, BulkDownloadReadyEvent } from "./bulkDownloadEvents";

/** queued: the request was accepted, the job has not started. preparing: documents are being added.
 *  merging: the file is being written. ready / failed: the window shows the outcome until closed. */
export type DownloadRunStatus = "queued" | "preparing" | "merging" | "ready" | "failed";

export interface DownloadRun {
    status: DownloadRunStatus;
    type: BulkDocType;
    /** What was asked for, shown after the project / vendor name: "All POs" or "12 selected", "With rate", … */
    details: string[];
    /** Documents finished so far, and how many there are (null until the job starts). */
    done: number;
    total: number | null;
    /** The PO / WO number being prepared now (PO, WO and DN downloads only). */
    current: string | null;
    /** When the first document started, and when the latest event came: the time left reads both. */
    startedAt: number | null;
    updatedAt: number | null;
    /** Ready: the file's name, and how many documents made it in (null from an older worker). */
    filename: string | null;
    included: number | null;
    /** Failed: the server's reason. */
    error: string | null;
}

const FAILED_FALLBACK = "The download failed. Please try again.";

/** These types merge uploaded files; the rest render one document per record. */
const FILE_TYPES: readonly BulkDocType[] = ["Invoice", "DC", "MIR", "MTC", "ClientInvoice", "WOPaymentVoucher"];

export const isWorking = (status: DownloadRunStatus) => status === "queued" || status === "preparing" || status === "merging";

export const startRun = (type: BulkDocType, details: string[]): DownloadRun => ({
    status: "queued", type, details,
    done: 0, total: null, current: null, startedAt: null, updatedAt: null,
    filename: null, included: null, error: null,
});

/**
 * The subtitle's details. `selected` is the wizard's count; a Quick Download leaves it out and
 * reads "All …". A PO / WO says whether rates are shown, an invoice download which invoices.
 */
export const runDetails = (
    type: BulkDocType,
    { selected, withRate, invoiceType }: { selected?: number; withRate?: boolean; invoiceType?: string },
): string[] => {
    const scope = selected != null ? `${selected} selected` : type === "Invoice" ? invoiceType ?? "All Invoices" : `All ${TYPE_INFO[type].short}`;
    const extra = type === "PO" || type === "WO" ? [withRate ? "With rate" : "Without rate"]
        : type === "Invoice" && selected != null && invoiceType ? [invoiceType]
        : [];
    return [scope, ...extra];
};

/** A progress event. A finished run ignores a late one, so it never reopens. */
export const applyProgress = (run: DownloadRun, e: BulkDownloadProgressEvent, now: number): DownloadRun => {
    if (!isWorking(run.status)) return run;
    const total = typeof e.total === "number" ? e.total : run.total;
    if (e.stage === "merging") {
        return { ...run, status: "merging", done: total ?? run.done, total, current: null, updatedAt: now };
    }
    return {
        ...run,
        status: "preparing",
        done: typeof e.done === "number" ? e.done : run.done,
        total,
        current: e.current ?? null,
        startedAt: run.startedAt ?? now,
        updatedAt: now,
    };
};

export const applyReady = (run: DownloadRun, e: BulkDownloadReadyEvent): DownloadRun => {
    const total = typeof e.total === "number" ? e.total : run.total;
    return {
        ...run, status: "ready", total, done: total ?? run.done, current: null,
        filename: e.filename, included: typeof e.included === "number" ? e.included : null,
    };
};

export const applyFailed = (run: DownloadRun, e: { message?: string }): DownloadRun =>
    ({ ...run, status: "failed", current: null, error: e.message || FAILED_FALLBACK });

/** Documents the file is missing (0 when the server did not say). */
export const missingCount = (run: DownloadRun): number =>
    run.included != null && run.total != null ? Math.max(run.total - run.included, 0) : 0;

/** "document" / "file", singular for one. */
export const unitNoun = (type: BulkDocType, n: number): string =>
    `${FILE_TYPES.includes(type) ? "file" : "document"}${n === 1 ? "" : "s"}`;

export const runTitle = (run: DownloadRun): string => {
    const name = TYPE_INFO[run.type].card;
    if (run.status === "failed") return "Download failed";
    if (run.status !== "ready") return `Downloading ${name}`;
    const missing = missingCount(run);
    return missing ? `${name} ready, ${missing} missing` : `${name} ready`;
};

/** Shown from the third finished document, so the first guess is not wild. Measured up to the latest
 *  event, so it is the same on every render. */
export const timeLeft = (run: DownloadRun): string | null => {
    if (run.status !== "preparing" || run.total == null || run.done < 3) return null;
    if (run.startedAt == null || run.updatedAt == null) return null;
    const seconds = ((run.updatedAt - run.startedAt) / run.done) * (run.total - run.done) / 1000;
    if (seconds < 60) return "Less than a minute left";
    return `About ${Math.round(seconds / 60)} min left`;
};
