/**
 * One bulk PDF download as a background operation (ADR 0047, #1664), shared by the Quick Download button and the
 * wizard. The shared hook follows the download's status record; this hook turns it into the progress window's
 * `run` (`utils/bulkDownload/bulkDownloadRun.followRun`), collects the finished file by operation id (only the
 * user who started it can), and sends the window's Cancel.
 *
 * A download outlives a dropped socket and a reload of the tab: the shared hook picks it up again from the tab's
 * sessionStorage under `storageKey`.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { useToast } from "@/components/ui/use-toast";
import { collectResultFile, useBackgroundOperation } from "@/hooks/useBackgroundOperation";
import { parseResultFile } from "@/utils/backgroundOps/operationFollower";
import { type BulkRunContext, type DownloadRun, followRun, isWorking, parseRunContext } from "@/utils/bulkDownload/bulkDownloadRun";

const CANCEL_METHOD = "nirmaan_stack.api.pdf_helper.bulk_download.cancel_bulk_download";

/** The finished file's counts, as the work returns them. */
export interface BulkDownloadResult {
    included: number | null;
    total: number | null;
}

const resultOf = (result: unknown): BulkDownloadResult => {
    const r = typeof result === "object" && result !== null ? (result as Record<string, unknown>) : {};
    return {
        included: typeof r.included === "number" ? r.included : null,
        total: typeof r.total === "number" ? r.total : null,
    };
};

/** Ask the server to stop one of this user's downloads. Best effort: the window has already closed. */
const cancelOnServer = (opId: string): Promise<unknown> => {
    const body = new FormData();
    body.append("op_id", opId);
    return fetch(`/api/method/${CANCEL_METHOD}`, {
        method: "POST",
        headers: { "X-Frappe-CSRF-Token": (window as unknown as { csrf_token?: string }).csrf_token ?? "" },
        body,
    }).catch(() => undefined);
};

const saveBlob = (blob: Blob, filename: string) => {
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
};

export interface BulkDownloadOperationOptions {
    storageKey: string;
    /** The file was handed to the browser. */
    onSaved?: (result: BulkDownloadResult, context: BulkRunContext) => void;
}

export function useBulkDownloadOperation({ storageKey, onSaved }: BulkDownloadOperationOptions) {
    const { toast } = useToast();
    const onSavedRef = useRef(onSaved);
    onSavedRef.current = onSaved;

    const op = useBackgroundOperation({
        storageKey,
        onFinished: async (result, context, opId) => {
            try {
                const blob = await collectResultFile(opId);
                saveBlob(blob, parseResultFile(result)?.filename ?? "Download.pdf");
            } catch (error) {
                toast({
                    title: "Download failed",
                    description: error instanceof Error ? error.message : "Could not fetch the file.",
                    variant: "destructive",
                });
                return;
            }
            const ctx = parseRunContext(context);
            if (ctx) onSavedRef.current?.(resultOf(result), ctx);
        },
    });

    // The window keeps its own clock (time left), so it is folded from each view rather than drawn from it.
    const [run, setRun] = useState<DownloadRun | null>(null);
    const { view, context, start: startOperation, reset } = op;
    useEffect(() => {
        setRun((previous) => followRun(previous, view, context, Date.now()));
    }, [view, context]);

    const start = useCallback(
        (method: string, args: Record<string, unknown>, runContext: BulkRunContext) => startOperation(method, args, runContext),
        [startOperation],
    );

    /** The progress window's Cancel: close it and tell the server to stop the download. */
    const cancel = useCallback(() => {
        const opId = view.phase === "idle" ? null : view.opId;
        reset();
        if (opId) void cancelOnServer(opId);
        toast({ title: "Download cancelled" });
    }, [view, reset, toast]);

    const working = run !== null && isWorking(run.status);
    return { run, working, start, cancel, close: reset };
}
