/**
 * One bulk download as the progress window shows it -- shared by the Quick Download button and the
 * wizard. Pure: `followRun` turns the download's background operation (ADR 0047) as the shared hook
 * sees it into what the window renders.
 */
import { isRecord, parseResultFile, type OpView } from "@/utils/backgroundOps/operationFollower";

import { BULK_DOC_TYPES, BulkDocType, TYPE_INFO } from "./bulkDownloadTypes";

/** The work's progress detail (`bulk_download_op`): `done` = finished documents, `current` = the PO /
 *  WO starting now; `stage: "merging"` while the file is written. */
export interface RunProgress {
    done?: number;
    total?: number;
    current?: string | null;
    stage?: "merging";
}

/** The finished file. `included` < `total` when some documents could not be added. */
export interface RunReady {
    filename: string;
    included?: number;
    total?: number;
}

/** What a download is started with, kept across a reload so the window can be drawn again. */
export interface BulkRunContext {
    type: BulkDocType;
    details: string[];
}

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
const FILE_TYPES: readonly BulkDocType[] = ["Invoice", "DC", "MIR", "MTC", "ClientInvoice", "WOPaymentVoucher", "PorterInvoice"];

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
export const applyProgress = (run: DownloadRun, e: RunProgress, now: number): DownloadRun => {
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

export const applyReady = (run: DownloadRun, e: RunReady): DownloadRun => {
    const total = typeof e.total === "number" ? e.total : run.total;
    return {
        ...run, status: "ready", total, done: total ?? run.done, current: null,
        filename: e.filename, included: typeof e.included === "number" ? e.included : null,
    };
};

export const applyFailed = (run: DownloadRun, e: { message?: string }): DownloadRun =>
    ({ ...run, status: "failed", current: null, error: e.message || FAILED_FALLBACK });

const numberOrUndefined = (value: unknown) => (typeof value === "number" ? value : undefined);

/** The context a download was started with, or null when it is not one (an older tab's slot). */
export const parseRunContext = (value: unknown): BulkRunContext | null => {
    if (!isRecord(value) || !Array.isArray(value.details)) return null;
    const type = BULK_DOC_TYPES.find((t) => t === value.type);
    return type ? { type, details: value.details.map(String) } : null;
};

const progressOf = (detail: Record<string, unknown> | undefined): RunProgress => ({
    done: numberOrUndefined(detail?.done),
    total: numberOrUndefined(detail?.total),
    current: typeof detail?.current === "string" ? detail.current : null,
    stage: detail?.stage === "merging" ? "merging" : undefined,
});

/**
 * The window for the operation the hook follows: `view` and `context` are the hook's, `run` the
 * window so far (it keeps the clock the time left is read from). Null when no download is followed.
 */
export const followRun = (run: DownloadRun | null, view: OpView, context: unknown, now: number): DownloadRun | null => {
    const ctx = parseRunContext(context);
    if (view.phase === "idle" || !ctx) return null;
    const base = view.phase === "starting" || !run || run.type !== ctx.type ? startRun(ctx.type, ctx.details) : run;
    switch (view.phase) {
        case "starting":
        case "queued":
            return base;
        case "running":
            return applyProgress(base, progressOf(view.progress?.detail), now);
        case "finished": {
            const result = isRecord(view.result) ? view.result : {};
            return applyReady(base, {
                filename: parseResultFile(view.result)?.filename ?? "",
                included: numberOrUndefined(result.included),
                total: numberOrUndefined(result.total),
            });
        }
        case "failed":
        case "lost":
            return applyFailed(base, { message: view.error });
    }
};

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
