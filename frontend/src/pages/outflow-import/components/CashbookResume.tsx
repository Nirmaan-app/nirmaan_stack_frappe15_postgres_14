// src/pages/outflow-import/components/CashbookResume.tsx
//
// Resume a Cashbook import whose job stopped part-way (#1589, spec #1585 gap F). Card Create's "Run Create
// again" is the model. The view logic is `cashbookPreview.showsResume` / `stoppedText`; the server
// (`cashbook.resume_cashbook_import`) asks every rule again on the press.

import { useCallback, useEffect, useRef, useState } from "react";
import { useFrappeGetCall, useFrappePostCall } from "frappe-react-sdk";
import { AlertTriangle, Loader2, RotateCw } from "lucide-react";

import { Button } from "@/components/ui/button";

import {
    CASHBOOK_RESUME_METHOD,
    CASHBOOK_STATUS_METHOD,
    type CashbookStatus,
    showsResume,
    stoppedText,
} from "../cashbookPreview";
import { describeFrappeError } from "../outflowTableModel";
import { CashbookBillsNotCopied } from "./CashbookBillsNotCopied";

/** How often a batch's status is re-read while its job is queued or running. */
const POLL_MS = 2000;

/**
 * The Resume button and, under it, the server's refusal word for word. `onResumed` receives the batch's
 * status as the server reports it after re-queueing the job (running).
 */
export const CashbookResumeButton = ({
    batch,
    onResumed,
}: {
    batch: string;
    onResumed: (status: CashbookStatus) => void;
}) => {
    const { call } = useFrappePostCall<{ message: CashbookStatus }>(CASHBOOK_RESUME_METHOD);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const resume = useCallback(async () => {
        setBusy(true);
        setError(null);
        try {
            const response = await call({ batch });
            onResumed(response.message);
        } catch (err) {
            setError(describeFrappeError(err, "Resume did not start."));
        } finally {
            setBusy(false);
        }
    }, [batch, call, onResumed]);

    return (
        <div className="space-y-1">
            <Button size="sm" onClick={resume} disabled={busy}>
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RotateCw className="mr-2 h-4 w-4" />}
                Resume
            </Button>
            {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
    );
};

/**
 * The pinned Cashbook import's job, on the transactions screen: "Stopped: N lines still waiting" with
 * Resume when its job stopped part-way, its progress while the job is queued or running, and, once it is done,
 * the bills it could not copy with their reasons (story 19, code review S3), or nothing when every bill was copied.
 * Read from the server by batch and polled while the job runs, so a reload shows exactly where it stands.
 * `onFinished` runs when a job it watched stops, so the screen behind re-reads its rows.
 */
export const CashbookJobPanel = ({ batch, onFinished }: { batch: string; onFinished?: () => void }) => {
    const { data, mutate } = useFrappeGetCall<{ message: CashbookStatus }>(
        CASHBOOK_STATUS_METHOD,
        { batch },
        `cashbook-status::${batch}`,
        { refreshInterval: (latest) => (latest?.message?.running ? POLL_MS : 0) },
    );
    const status = data?.message ?? null;

    const wasRunning = useRef(false);
    useEffect(() => {
        if (!status) return;
        if (wasRunning.current && !status.running) onFinished?.();
        wasRunning.current = status.running;
    }, [status, onFinished]);

    const onResumed = useCallback(
        (next: CashbookStatus) => void mutate({ message: next }, { revalidate: false }),
        [mutate],
    );

    if (!status) return null;
    if (status.running) {
        return (
            <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-4 py-3 text-sm">
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
                <span>
                    Creating… {status.created} created, {status.pending} still waiting.
                </span>
            </div>
        );
    }
    if (!showsResume(status)) {
        if (!(status.bills_not_copied ?? []).length) return null;
        return (
            <div className="rounded-md border bg-muted/30 px-4 py-3">
                <CashbookBillsNotCopied status={status} />
            </div>
        );
    }
    return (
        <div className="space-y-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm dark:border-amber-800 dark:bg-amber-950/30">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                    <div>
                        <p className="font-medium text-amber-800 dark:text-amber-400">{stoppedText(status)}</p>
                        <p className="text-xs text-muted-foreground">
                            This import's job stopped before it finished. Resume creates only the lines still waiting
                            and copies only the bills still to copy; it never creates a line twice.
                        </p>
                    </div>
                </div>
                <CashbookResumeButton batch={batch} onResumed={onResumed} />
            </div>
            <CashbookBillsNotCopied status={status} />
        </div>
    );
};
