import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { TYPE_STYLE } from "@/utils/bulkDownload/bulkDownloadStyle";
import { DownloadRun, isWorking, missingCount, runTitle, timeLeft, unitNoun } from "@/utils/bulkDownload/bulkDownloadRun";

interface BulkDownloadProgressDialogProps {
    /** The download on screen; null keeps the window closed. */
    run: DownloadRun | null;
    /** The project / vendor name, first in the subtitle. */
    scopeName?: string;
    onCancel: () => void;
    /** Closes a finished (ready / failed) window. */
    onClose: () => void;
}

/** After this long in the queue, the window says other downloads are ahead. */
const QUEUE_NOTE_AFTER_MS = 10_000;
/** A complete file closes the window by itself after this long; one with missing documents waits. */
const AUTO_CLOSE_MS = 2_000;

/**
 * The bulk download progress window, shared by the Quick Download button and the wizard. While the
 * job runs it cannot be dismissed (leaving the page cancels the job), only cancelled; once ready or
 * failed it shows the outcome until closed.
 */
export const BulkDownloadProgressDialog = ({ run, scopeName, onCancel, onClose }: BulkDownloadProgressDialogProps) => {
    const status = run?.status;
    const missing = run ? missingCount(run) : 0;

    const [queueNote, setQueueNote] = useState(false);
    useEffect(() => {
        setQueueNote(false);
        if (status !== "queued") return;
        const t = setTimeout(() => setQueueNote(true), QUEUE_NOTE_AFTER_MS);
        return () => clearTimeout(t);
    }, [status]);

    useEffect(() => {
        if (status !== "ready" || missing) return;
        const t = setTimeout(onClose, AUTO_CLOSE_MS);
        return () => clearTimeout(t);
    }, [status, missing, onClose]);

    if (!run) return null;

    const working = isWorking(run.status);
    const { done, total } = run;
    const percent = total ? Math.round((done / total) * 100) : 0;
    const subtitle = [scopeName, ...run.details].filter(Boolean).join(" · ");

    const tile = run.status === "failed" ? { icon: XCircle, iconBg: "bg-red-50", iconColor: "text-red-600" }
        : run.status === "ready" && missing ? { icon: AlertTriangle, iconBg: "bg-amber-50", iconColor: "text-amber-600" }
        : run.status === "ready" ? { icon: CheckCircle2, iconBg: "bg-green-50", iconColor: "text-green-600" }
        : TYPE_STYLE[run.type];
    const TileIcon = tile.icon;

    const bar = run.status === "failed" ? { width: 100, color: "bg-destructive" }
        : run.status === "ready" ? { width: 100, color: missing ? "bg-amber-500" : "bg-green-600" }
        // Queued, an older worker's event without counts, or merging: no figure to show, so it pulses.
        : run.status === "merging" || total == null ? { width: 100, color: "bg-primary/40 animate-pulse" }
        : { width: percent, color: "bg-primary" };

    let countLeft: string | null = null;
    let countRight: string | null = null;
    if (run.status === "queued") countLeft = "Starting…";
    else if (run.status === "ready" && total != null) countLeft = `${run.included ?? total} of ${total} ${unitNoun(run.type, total)} included`;
    else if (working && total != null) {
        countLeft = `${done} of ${total} ${unitNoun(run.type, total)}`;
        countRight = `${percent}%`;
    } else if (working) countLeft = "Working…";

    let detail: string | null = null;
    if (run.status === "queued") {
        detail = queueNote ? "Other downloads are running. Yours will start automatically." : "Waiting for the server to start…";
    } else if (run.status === "preparing") detail = run.current;
    else if (run.status === "merging") detail = total != null ? `Combining ${total} ${unitNoun(run.type, total)} into one PDF…` : "Combining into one PDF…";
    else if (run.status === "ready") {
        detail = missing ? `${missing} ${unitNoun(run.type, missing)} could not be added.` : `${run.filename} · downloading`;
    } else detail = run.error;

    return (
        <Dialog open onOpenChange={(open) => { if (!open && !working) onClose(); }}>
            <DialogContent
                disableCloseIcon={false}
                className="w-[calc(100%-2rem)] sm:max-w-[480px] p-0 gap-0 overflow-hidden rounded-lg"
                onPointerDownOutside={(e) => working && e.preventDefault()}
                onEscapeKeyDown={(e) => working && e.preventDefault()}
            >
                <div className="px-6 pt-6 pb-5 space-y-5">
                    <div className="flex items-start gap-3">
                        <div className={cn("h-10 w-10 rounded-lg flex items-center justify-center shrink-0", tile.iconBg)}>
                            <TileIcon className={cn("h-5 w-5", tile.iconColor)} />
                        </div>
                        <div className="min-w-0 pt-0.5">
                            <DialogTitle className="text-base font-semibold leading-tight">{runTitle(run)}</DialogTitle>
                            <DialogDescription className="text-sm text-muted-foreground truncate mt-1" title={subtitle}>
                                {subtitle}
                            </DialogDescription>
                        </div>
                    </div>

                    <div className="space-y-2">
                        {countLeft && (
                            <div className="flex items-baseline justify-between gap-3 text-sm font-medium tabular-nums">
                                <span>{countLeft}</span>
                                {countRight && <span className="text-muted-foreground">{countRight}</span>}
                            </div>
                        )}
                        <div
                            className="h-2 w-full rounded-full bg-muted overflow-hidden"
                            role="progressbar"
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={working && total != null ? percent : undefined}
                        >
                            <div className={cn("h-full rounded-full transition-all duration-300 ease-out", bar.color)} style={{ width: `${bar.width}%` }} />
                        </div>
                        <div className="flex items-start justify-between gap-3 text-xs text-muted-foreground min-h-4">
                            <span className={cn(run.status === "failed" ? "text-destructive" : "truncate")} title={detail ?? undefined}>
                                {detail}
                            </span>
                            {run.status === "preparing" && <span className="shrink-0">{timeLeft(run)}</span>}
                        </div>
                    </div>
                </div>

                <div className="border-t bg-muted/30 px-6 py-4 flex items-center justify-between gap-4">
                    <p className="text-xs text-muted-foreground">
                        {working ? "Keep this page open until the file downloads." : ""}
                    </p>
                    {working ? (
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={onCancel}
                            className="shrink-0 border-red-400 text-red-600 hover:bg-red-50 hover:text-red-700"
                        >
                            Cancel download
                        </Button>
                    ) : (
                        <Button variant="outline" size="sm" onClick={onClose} className="shrink-0">
                            Close
                        </Button>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
};
