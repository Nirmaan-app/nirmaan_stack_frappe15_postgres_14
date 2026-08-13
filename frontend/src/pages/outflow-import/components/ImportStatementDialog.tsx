// src/pages/outflow-import/components/ImportStatementDialog.tsx

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
    AlertTriangle,
    CheckCircle2,
    FileSpreadsheet,
    Loader2,
    RefreshCw,
    Upload,
} from "lucide-react";
import { useFrappePostCall } from "frappe-react-sdk";

import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { WizardSteps } from "@/components/ui/wizard-steps";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    OutflowPreviewResult,
    OutflowUploadResult,
} from "@/types/NirmaanStack/OutflowImportBatch";
import { formatDate } from "@/utils/FormatDate";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";

import { describeFrappeError, previewCounts, statementDebit } from "../outflowTableModel";
import {
    CashbookConfirmResult,
    CashbookPreviewResult,
    CashbookStatus,
    createLabel,
    progressFraction,
    progressText,
} from "../cashbookPreview";
import {
    CONFIRM_STEP_NOTE,
    FINISH_LATER_NOTE,
    clickableStepIndex,
    confirmEmptyCopy,
    currentStepIndex,
    importSteps,
} from "../importWizard";
import { CashbookReviewTree } from "./CashbookReviewTree";
import { ConfirmMatchedPanel } from "./ConfirmMatchedPanel";

const PREVIEW_URL =
    "/api/method/nirmaan_stack.api.outflow_import.upload.preview_outflow_statement";
const UPLOAD_URL =
    "/api/method/nirmaan_stack.api.outflow_import.upload.upload_outflow_statement";
const CASHBOOK_PREVIEW_URL =
    "/api/method/nirmaan_stack.api.outflow_import.cashbook.preview_cashbook_statement";
const CASHBOOK_CONFIRM_URL =
    "/api/method/nirmaan_stack.api.outflow_import.cashbook.confirm_cashbook_import";

/** A Cashbook import writes in the background, so the dialog watches the rows rather than waiting. */
const STATUS_POLL_MS = 1500;

/**
 * The confirm step's scope: no filters at all (owner ruling Q21).
 *
 * ⚠️ A MODULE CONSTANT, NOT AN INLINE `{}`. `ConfirmMatchedPanel` keys its SWR cache on
 * `JSON.stringify(scope)` and passes the object straight to the fetch — a fresh literal every render
 * is a fresh identity, and the refetch churn that follows is invisible until somebody profiles it.
 */
const EMPTY_CONFIRM_SCOPE: Record<string, unknown> = {};

// Mirrors the server's own limits (api/outflow_import/upload.py). Client-side is a courtesy so a
// wrong file fails instantly; the endpoint is the boundary.
// .xlsx joins .csv at Q10 -- the server sniffs the real format from the bytes, so a renamed export
// still works and this list only decides what we accept by name.
const ALLOWED_EXTENSIONS = [".csv", ".xlsx"];
const MAX_FILE_BYTES = 5 * 1024 * 1024;

/** Only sources the backend parser actually has an adapter for may be selected. */
const SOURCES = [
    { value: "Cashfree", label: "Cashfree", available: true },
    { value: "Cashbook", label: "Cashbook (petty cash)", available: true },
];

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Called once the import is staged AND matched, with the new batch's name. */
    /**
     * The statement is in and matched.
     *
     * ⚠️ IT CARRIES THE STATEMENT'S OWN PERIOD (slice P1), not just the batch id. The screen is
     * scoped to a period now, and a statement is routinely uploaded weeks after its transfers
     * moved -- so a fresh import can land entirely OUTSIDE the default window and the page would
     * refresh to a summary that does not mention it and a table that does not list it. That reads
     * as a failed upload. The caller uses these dates to bring what was just imported into view.
     */
    onImported: (
        batch: string,
        period?: { from?: string | null; to?: string | null },
        source?: string
    ) => void;
    /**
     * Re-read the screen behind, WITHOUT moving the period or the tab (slice CF/S7).
     *
     * ⚠️ IT IS NOT `onImported` CALLED AGAIN. That one also sets the period and, for Cashbook, the
     * tab — right once, when the statement arrives. Calling it after every settle inside step 4
     * would yank the tab out from under somebody mid-review.
     */
    onRefresh?: () => Promise<void> | void;
}

/**
 * Upload a bank statement (slice X4) -- the whole of the retired `NewOutflowImportPage`, in a dialog.
 *
 * ⚠️ IT RUNS THE MATCH ITSELF AND ONLY CLOSES WHEN THAT IS DONE, which is the one behavioural change
 * from the page it replaces. "Run match" used to be a separate button on a separate screen the
 * reviewer had to find after uploading -- and there is no case where somebody imports a statement
 * and does NOT want it matched. A manual re-run stays on the summary panel, because re-running is a
 * normal act: payments get ticked Paid by hand all day, so a batch matched at 10:00 finds different
 * things at 16:00.
 *
 * ⚠️ THE UPLOAD AND THE MATCH ARE TWO SEPARATE SERVER CALLS AND THE FAILURE SHAPES DIFFER. If the
 * upload succeeds and the match then fails, the rows ARE staged -- the dialog says so and hands the
 * batch back, rather than reporting a failure that would send somebody to re-upload a statement
 * that is already in.
 */
export const ImportStatementDialog = ({ open, onOpenChange, onImported, onRefresh }: Props) => {
    const inputRef = useRef<HTMLInputElement>(null);

    const [source, setSource] = useState("Cashfree");
    const [file, setFile] = useState<File | null>(null);
    const [isBusy, setIsBusy] = useState<"preview" | "upload" | "match" | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [preview, setPreview] = useState<OutflowPreviewResult | null>(null);
    const [staged, setStaged] = useState<OutflowUploadResult | null>(null);
    const [isDragging, setIsDragging] = useState(false);

    // Cashbook's own three states. Kept separate from the Cashfree ones rather than widened into
    // them: the two flows share a file picker and nothing else, and a union of both shapes would
    // make every render below ask which source it is looking at.
    const [cashbookPreview, setCashbookPreview] = useState<CashbookPreviewResult | null>(null);
    const [cashbookBatch, setCashbookBatch] = useState<CashbookConfirmResult | null>(null);
    const [cashbookStatus, setCashbookStatus] = useState<CashbookStatus | null>(null);

    /**
     * The Cashfree match has FINISHED, which is not the same as "not running" (slice CF/S7).
     *
     * ⚠️ IT IS WHAT SEPARATES STEP 3 FROM STEP 4, AND A FAILURE MUST NOT SET IT. `isBusy` goes back
     * to null whether the match succeeded or threw, so deriving the step from it would advance a
     * failed run to Confirm — where the list would be honestly empty for entirely the wrong reason.
     */
    const [matched, setMatched] = useState(false);
    /** True while the settle loop inside the confirm step is writing. Blocks dismissal. */
    const [confirming, setConfirming] = useState(false);
    /** Bumped by a re-run so the confirm panel remounts and refetches rather than showing stale rows. */
    const [rematchNonce, setRematchNonce] = useState(0);

    const isCashbook = source === "Cashbook";

    const { call: runMatch } = useFrappePostCall(
        "nirmaan_stack.api.outflow_import.review.match_batch"
    );

    /**
     * The step-4 re-run, which is NOT the same call the import itself makes.
     *
     * ⚠️ IT SPANS EVERY OPEN IMPORT (owner ruling Q2), while the step-3 match is this batch's own.
     * The point of pressing it here is that a payment approved since the last run may belong to an
     * older statement — so scoping it to the file just uploaded would answer a question nobody
     * asked. `match_period` with no filters resolves the open imports server-side, and skips the
     * `Completed` ones (slice CF/S5).
     */
    const { call: runMatchAcrossOpenImports, loading: rematching } = useFrappePostCall(
        "nirmaan_stack.api.outflow_import.review.match_period"
    );

    // A dialog is REUSED, unlike the page it replaces -- which was unmounted and rebuilt on every
    // visit. Without this reset, the second import opens showing the first one's preview.
    useEffect(() => {
        if (open) return;
        setFile(null);
        setPreview(null);
        setStaged(null);
        setError(null);
        setIsBusy(null);
        setMatched(false);
        setConfirming(false);
        setCashbookPreview(null);
        setCashbookBatch(null);
        setCashbookStatus(null);
    }, [open]);

    // Switching source mid-dialog must drop whatever the other one produced, or the tree from a
    // Cashbook read stays on screen under a Cashfree heading.
    useEffect(() => {
        setPreview(null);
        setStaged(null);
        setMatched(false);
        setCashbookPreview(null);
        setCashbookBatch(null);
        setCashbookStatus(null);
        setError(null);
    }, [source]);

    const acceptFile = useCallback((candidate: File | undefined | null) => {
        setError(null);
        setPreview(null);
        setStaged(null);
        if (!candidate) return;

        const lower = candidate.name.toLowerCase();
        if (!ALLOWED_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
            setError("We support .csv and .xlsx statements.");
            return;
        }
        if (candidate.size > MAX_FILE_BYTES) {
            setError(
                `This file is ${(candidate.size / (1024 * 1024)).toFixed(1)} MB. Maximum is ${
                    MAX_FILE_BYTES / (1024 * 1024)
                } MB.`
            );
            return;
        }
        setFile(candidate);
    }, []);

    /**
     * POST the statement to `url`.
     *
     * ⚠️ THE FILE IS SENT TWICE -- once to preview, once to confirm -- AND THAT IS THE DESIGN. The
     * server holding a parse between the two requests would mean session state, an expiry, and a
     * way for confirm to act on a file that is no longer the one on screen. A statement is a few
     * kilobytes; sending it again is cheaper than any of that.
     */
    const post = useCallback(
        async (url: string) => {
            const body = new FormData();
            body.append("file", file!, file!.name);
            body.append("source", source);

            // Raw multipart fetch, not the SDK -- the file rides the same POST as the text field.
            // Do NOT set Content-Type: the browser must add the multipart boundary itself.
            const response = await fetch(url, {
                method: "POST",
                body,
                headers: { "X-Frappe-CSRF-Token": (window as any).csrf_token || "" },
            });
            if (!response.ok) {
                const text = await response.text();
                throw new Error(
                    extractServerMessage(text) || `Request failed (${response.status}).`
                );
            }
            return (await response.json())?.message;
        },
        [file, source]
    );

    const handlePreview = useCallback(async () => {
        if (!file || isBusy) return;
        setIsBusy("preview");
        setError(null);
        if (isCashbook) {
            try {
                const message = (await post(CASHBOOK_PREVIEW_URL)) as
                    | CashbookPreviewResult
                    | undefined;
                if (!message?.preview) {
                    setError("The server read the file but returned no preview.");
                    return;
                }
                setCashbookPreview(message);
            } catch (err: any) {
                setError(describeFrappeError(err, "Could not read this statement."));
            } finally {
                setIsBusy(null);
            }
            return;
        }
        try {
            const message = (await post(PREVIEW_URL)) as OutflowPreviewResult | undefined;
            if (!message?.preview) {
                setError("The server read the file but returned no preview.");
                return;
            }
            setPreview(message);
        } catch (err: any) {
            setError(describeFrappeError(err, "Could not read this statement."));
        } finally {
            setIsBusy(null);
        }
    }, [file, isBusy, isCashbook, post]);

    /**
     * Start a Cashbook import and watch it finish.
     *
     * ⚠️ THE DIALOG STAYS OPEN UNTIL THE JOB IS DONE. The rows are written in the background, so
     * closing on the confirm response would report "imported" while nothing had been created yet --
     * and the screen behind would show a batch of pending rows filling in silently. A job that
     * cannot be STARTED leaves nothing behind and is reported as a failure; one that started and
     * then had trouble reports itself through the rows, which is where the evidence is.
     */
    const handleCashbookConfirm = useCallback(async () => {
        if (!file || isBusy) return;
        setIsBusy("upload");
        setError(null);
        try {
            const message = (await post(CASHBOOK_CONFIRM_URL)) as CashbookConfirmResult | undefined;
            if (!message?.batch) {
                setError("The server accepted the file but returned no batch.");
                setIsBusy(null);
                return;
            }
            setCashbookBatch(message);
        } catch (err: any) {
            setError(describeFrappeError(err, "The import could not be started."));
            setIsBusy(null);
            return;
        }
        setIsBusy("match");
    }, [file, isBusy, post]);

    /**
     * Poll the rows until nothing is pending.
     *
     * ⚠️ IT POLLS THE ROWS, NOT A JOB HANDLE. The rows are the durable record -- they survive a
     * worker restart and a browser refresh -- so a reload mid-import picks the progress back up
     * rather than losing it.
     */
    useEffect(() => {
        if (!cashbookBatch || isBusy !== "match") return;
        let cancelled = false;

        const tick = async () => {
            try {
                const response = await fetch(
                    `/api/method/nirmaan_stack.api.outflow_import.cashbook.get_cashbook_status?batch=${encodeURIComponent(
                        cashbookBatch.batch
                    )}`,
                    { headers: { Accept: "application/json" } }
                );
                if (!response.ok) return;
                const status = (await response.json())?.message as CashbookStatus | undefined;
                if (cancelled || !status) return;
                setCashbookStatus(status);
                if (!status.running) setIsBusy(null);
            } catch {
                // A dropped poll is not a failed import -- the next tick asks again, and the rows
                // are the truth either way. Reporting it would make a flaky network look like lost
                // money.
            }
        };

        void tick();
        const timer = setInterval(tick, STATUS_POLL_MS);
        return () => {
            cancelled = true;
            clearInterval(timer);
        };
    }, [cashbookBatch, isBusy]);

    const handleCashbookDone = useCallback(() => {
        if (!cashbookBatch) return;
        onImported(
            cashbookBatch.batch,
            { from: cashbookPreview?.period_from, to: cashbookPreview?.period_to },
            "Cashbook"
        );
        onOpenChange(false);
    }, [cashbookBatch, cashbookPreview, onImported, onOpenChange]);


    const handleConfirm = useCallback(async () => {
        if (!file || isBusy) return;
        setIsBusy("upload");
        setError(null);

        let batch: string;
        let period: { from?: string | null; to?: string | null } | undefined;
        try {
            const message = (await post(UPLOAD_URL)) as OutflowUploadResult | undefined;
            if (!message?.batch) {
                setError("The server accepted the file but returned no batch.");
                setIsBusy(null);
                return;
            }
            setStaged(message);
            batch = message.batch;
            period = { from: message.period_from, to: message.period_to };
        } catch (err: any) {
            setError(describeFrappeError(err, "The upload failed."));
            setIsBusy(null);
            return;
        }

        // ⚠️ PAST THIS POINT THE ROWS ARE WRITTEN. A match failure is reported as a match failure --
        // never as an upload failure, which would send somebody to re-import a statement that is
        // already in (and which the duplicate guard would then refuse, confusingly).
        setIsBusy("match");
        try {
            await runMatch({ batch });
        } catch (err: any) {
            // ⚠️ THE ADVICE CHANGED WITH THE WIZARD (slice CF/S7). It used to say "use Re-run match
            // on the summary", which was right while this dialog closed on failure. It no longer
            // closes -- the reviewer is standing on step 3, which now HAS that button -- so pointing
            // at another screen would send them away from the control that fixes it.
            setError(
                `The statement was imported, but matching it failed: ${describeFrappeError(
                    err,
                    "no reason was returned"
                )} Try “Re-run match” below.`
            );
            setIsBusy(null);
            onImported(batch, period, source);
            return;
        }
        setIsBusy(null);
        setMatched(true);
        // ⚠️ THE PAGE BEHIND IS REFRESHED NOW, AND THE DIALOG STAYS OPEN (owner ruling Q1). Until
        // CF/S7 those two happened together. Refreshing here means that whenever the reviewer does
        // close -- after confirming, or straight away -- the screen behind is already current and the
        // statement they just imported is in view rather than outside the default period.
        onImported(batch, period, source);
    }, [file, isBusy, post, runMatch, onImported, source]);

    /**
     * Step 4's re-run, and step 3's retry after a failed match.
     *
     * ⚠️ IT REACHES EVERY OPEN IMPORT, NOT JUST THIS ONE (owner ruling Q2). The reason to press it
     * after an upload is that a payment approved since the last run may belong to an OLDER
     * statement, so scoping it to the file just uploaded would answer a question nobody asked.
     * `match_period` with no filters resolves the open imports server-side and skips the `Completed`
     * ones (slice CF/S5).
     *
     * ⚠️ A FAILURE HERE IS NOT AN IMPORT FAILURE. By this point the statement is in, so the message
     * says what did not happen rather than casting doubt on what did.
     */
    const handleRematchOpenImports = useCallback(async () => {
        setError(null);
        try {
            await runMatchAcrossOpenImports({});
            // Whatever the run changed, the confirm list is now stale. Bumping the nonce remounts
            // the panel so it refetches rather than showing what was true a moment ago.
            setMatched(true);
            setRematchNonce((n) => n + 1);
            await onRefresh?.();
        } catch (err: any) {
            setError(
                `The re-run failed: ${describeFrappeError(
                    err,
                    "no reason was returned"
                )} The import itself is unaffected.`
            );
        }
    }, [runMatchAcrossOpenImports, onRefresh]);

    const working = isBusy === "upload" || isBusy === "match";

    /**
     * The step, DERIVED from what the server has actually done (slice CF/S7).
     *
     * ⚠️ NEVER A SEPARATE `currentStep` NUMBER. A pointer held beside the flow is free to disagree
     * with what is on screen — showing "Confirm" over an unmatched statement, or "Upload" after the
     * rows were written. Every input here is a fact about the server, so the stepper can only ever
     * describe something that really happened.
     */
    const flow = {
        previewed: isCashbook ? Boolean(cashbookPreview) : Boolean(preview),
        staged: isCashbook ? Boolean(cashbookBatch) : Boolean(staged),
        matched,
    };
    const steps = importSteps(source);
    const stepIndex = currentStepIndex(source, flow);
    const onConfirmStep = !isCashbook && stepIndex === 3;

    /**
     * Drop the preview and go back to the file picker.
     *
     * ⚠️ REACHABLE ONLY FROM STEP 1, and `canStepBack` is what enforces it. From step 2 on the rows
     * are staged, and "back" would offer a re-upload the duplicate guard will refuse — a promise
     * that cannot be kept.
     */
    const goBackToUpload = useCallback(() => {
        setPreview(null);
        setCashbookPreview(null);
        setError(null);
    }, []);

    // ⚠️ THE DIALOG REFUSES TO CLOSE WHILE ANYTHING IS WRITING -- the upload, the match, or the
    // settle loop inside step 4. `confirming` is the panel's own state, reported up through
    // `onRunningChange`, because only this component owns the dismiss.
    const locked = working || confirming;

    return (
        <Dialog open={open} onOpenChange={(next) => (locked ? null : onOpenChange(next))}>
            {/* ⚠️ WIDE ENOUGH THAT NO FIGURE WRAPS (owner ruling 2026-08-10). The summary sets a
                label against a right-aligned value on one line, and a wrapped period or a wrapped
                rupee figure is the difference between a block that reads as a statement and one
                that reads as broken. Every label and value below carries `whitespace-nowrap`; this
                width is what stops that turning into overflow instead. */}
            {/* ⚠️ HEIGHT IS BOUNDED AND THE BODY SCROLLS -- the `DecisionDialog` pattern, copied
                whole. This dialog had NO height bound at all, so a tall body ran off the screen and
                took the buttons with it; a Cashbook review of fourteen groups does exactly that, and
                a Cashfree preview with many warnings already could.

                `grid-rows-[auto_1fr_auto]` pins the header and the body's own footer while the middle
                scrolls, and `min-h-0` on that middle row is the load-bearing token: a grid child
                defaults to `min-height: auto` and refuses to shrink below its content, so without it
                the body never scrolls and `max-h-[85vh]` looks like it simply does not work.

                Width keys off the SOURCE, so it is settled before any body renders and never resizes
                mid-flow. Cashfree keeps its own width for the reason above; Cashbook takes the wider
                one because its tree carries a label, a count and an amount on every line. */}
            <DialogContent
                className={`grid max-h-[85vh] grid-rows-[auto_1fr_auto] gap-0 overflow-hidden p-0 ${
                    // ⚠️ THE CONFIRM STEP TAKES THE WIDE FORM TOO (slice CF/S7). It renders the same
                    // vendor tree the standalone confirm dialog does at `max-w-5xl`; at the Cashfree
                    // width its columns collapse.
                    isCashbook || onConfirmStep ? "w-[min(92vw,1024px)] sm:max-w-none" : "max-w-3xl"
                }`}
            >
                <DialogHeader className="space-y-4 px-6 pb-2 pt-6">
                    <div className="space-y-1.5">
                        <DialogTitle>
                            {isCashbook
                                ? "Import a petty cash statement"
                                : "Import a bank statement"}
                        </DialogTitle>
                        <DialogDescription>
                            {isCashbook
                                ? "Wallet spends that have already left the account. Each one becomes an expense record."
                                : "Transfers that have already left the bank. Nothing is settled by importing — every row is confirmed by a person afterwards."}
                        </DialogDescription>
                    </div>
                    {/* ⚠️ THE STEP COUNT IS FIXED PER SOURCE AND NEVER RENUMBERS MID-FLOW. Step 4
                        renders even when nothing matched, because a wizard whose last step vanishes
                        when it has nothing to report reads as a crash.

                        ⚠️ CLICKING A CIRCLE ONLY WORKS BEFORE ANYTHING IS WRITTEN. `clickableStepIndex`
                        allows a completed step, and only while `canStepBack` -- from step 2 on the
                        rows are staged and there is nothing to go back to. */}
                    <WizardSteps
                        steps={steps}
                        currentStep={stepIndex}
                        onStepClick={(target) => {
                            if (clickableStepIndex(source, flow, target)) goBackToUpload();
                        }}
                        allowForwardNavigation={false}
                    />
                </DialogHeader>

                <div className="min-h-0 space-y-5 overflow-y-auto px-6 py-4">
                    {/* ⚠️ THE SOURCE PICKER AND THE DROP ZONE BELONG TO STEP 1 ONLY. They used to sit
                        above every state, which was harmless when the flow was one column of
                        stacked sections -- under a stepper it would put "choose a file" on a screen
                        headed "Confirm", over a statement already in the database. */}
                    {stepIndex === 0 && (
                        <>
                    <div className="space-y-2">
                        <Label htmlFor="outflow-source">Source</Label>
                        <Select value={source} onValueChange={setSource} disabled={working}>
                            <SelectTrigger id="outflow-source" className="max-w-xs">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {SOURCES.map((s) => (
                                    <SelectItem key={s.value} value={s.value} disabled={!s.available}>
                                        {s.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div
                        onDragOver={(e) => {
                            e.preventDefault();
                            setIsDragging(true);
                        }}
                        onDragLeave={() => setIsDragging(false)}
                        onDrop={(e) => {
                            e.preventDefault();
                            setIsDragging(false);
                            if (!working) acceptFile(e.dataTransfer.files?.[0]);
                        }}
                        onClick={() => !working && inputRef.current?.click()}
                        className={`flex cursor-pointer flex-col items-center justify-center rounded-md border-2 border-dashed p-6 text-center transition-colors ${
                            isDragging ? "border-primary bg-primary/5" : "border-muted-foreground/25"
                        } ${working ? "pointer-events-none opacity-60" : ""}`}
                    >
                        <input
                            ref={inputRef}
                            type="file"
                            accept=".csv,.xlsx"
                            className="hidden"
                            onChange={(e) => acceptFile(e.target.files?.[0])}
                        />
                        {file ? (
                            <>
                                <FileSpreadsheet className="mb-2 h-7 w-7 text-primary" />
                                <p className="font-medium">{file.name}</p>
                                <p className="text-xs text-muted-foreground">
                                    {(file.size / 1024).toFixed(1)} KB — click to choose another
                                </p>
                            </>
                        ) : (
                            <>
                                <Upload className="mb-2 h-7 w-7 text-muted-foreground" />
                                <p className="font-medium">Drop a .csv or .xlsx statement here</p>
                                <p className="text-xs text-muted-foreground">or click to browse</p>
                            </>
                        )}
                    </div>

                            <Button onClick={handlePreview} disabled={!file || isBusy !== null}>
                                {isBusy === "preview" && (
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                )}
                                {isBusy === "preview" ? "Reading statement…" : "Read statement"}
                            </Button>
                        </>
                    )}

                    {/* ⚠️ THE ERROR BANNER SPANS EVERY STEP, DELIBERATELY. Each step can fail in its
                        own way -- an unreadable file, a refused upload, a failed match, a refused
                        re-run -- and the message always belongs beside the step that produced it. */}
                    {error && (
                        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                            <span>{error}</span>
                        </div>
                    )}

                    {/* ⚠️ THE FILE IS NAMED ON EVERY STEP AFTER THE FIRST. The drop zone used to
                        carry it, and gating the drop zone to step 1 quietly took the filename with
                        it -- leaving a reviewer to confirm a statement without being able to see
                        WHICH statement. On the last screen before anything is written, that is the
                        one fact that has to stay on screen. */}
                    {stepIndex > 0 && file && (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <FileSpreadsheet className="h-3.5 w-3.5 shrink-0" />
                            <span className="truncate font-medium text-foreground">{file.name}</span>
                            <span className="shrink-0">· {source}</span>
                        </div>
                    )}

                    {/* STEP 2 -- what importing this statement WOULD do. Nothing is written yet. */}
                    {stepIndex === 1 &&
                        (isCashbook ? (
                            cashbookPreview && <CashbookReviewTree preview={cashbookPreview} />
                        ) : (
                            preview && (
                                <StatementPreview
                                    preview={preview}
                                    busy={working}
                                    phase={isBusy}
                                    onConfirm={handleConfirm}
                                    onChooseAnother={() => inputRef.current?.click()}
                                />
                            )
                        ))}

                    {/* STEP 3 -- the rows are IN. For Cashfree this is the staged summary while the
                        match runs; for Cashbook it is the creation job's progress. */}
                    {stepIndex === 2 && !isCashbook && staged && (
                        <StagedSummary result={staged} matching={isBusy === "match"} />
                    )}

                    {/* ⚠️ A FAILED MATCH KEEPS THE REVIEWER ON STEP 3, WITH THE FIX IN REACH (owner
                        ruling Q31), AND THE FIX IS THE FOOTER'S Re-run BUTTON -- there is
                        deliberately no second copy here. Advancing to Confirm would show an honestly
                        empty list for the wrong reason: "nothing matched" and "the match never ran"
                        are different sentences, and only the second one has a Re-run as its answer.
                        The footer renders from step 3 on, so it is already on screen. */}

                    {/* STEP 4 -- confirm. See `CONFIRM_STEP_NOTE` on why this reaches wider than the
                        statement that was just imported. */}
                    {onConfirmStep && (
                        <div className="space-y-4">
                            <p className="text-xs text-muted-foreground">{CONFIRM_STEP_NOTE}</p>
                            <ConfirmMatchedPanel
                                // ⚠️ REMOUNTED AFTER A RE-RUN so the list refetches. Without the
                                // key the panel keeps showing what was confirmable before the run.
                                key={rematchNonce}
                                // ⚠️ NO FILTERS: every confirmable transfer, any import, any period
                                // (owner ruling Q21). A confirmable row is `Matched` WITH a stored
                                // suggestion, which only exists inside an open batch -- so this
                                // already IS the open-import set, with no new server concept.
                                filters={EMPTY_CONFIRM_SCOPE}
                                active={onConfirmStep}
                                onClose={() => onOpenChange(false)}
                                onSettled={async () => {
                                    await onRefresh?.();
                                }}
                                onRunningChange={setConfirming}
                                Title="h3"
                                Description="p"
                                // Both found in the browser walk, and both are about this step's
                                // wider scope: the panel's shipped empty state said "in this
                                // import", contradicting the line directly above it, and its
                                // "Cancel" read as an offer to undo an import that is already
                                // written. "Finish later" in the footer is the honest exit.
                                emptyNote={confirmEmptyCopy(
                                    Math.max((staged?.total_rows ?? 0) - (staged?.skipped_rows ?? 0), 0)
                                )}
                                showCancel={false}
                            />
                        </div>
                    )}

                    {/* Once the job is running the tree is replaced by what it is doing. The tree
                        described a plan; while it executes, the plan is no longer the news. */}
                    {isCashbook && cashbookBatch && (
                        <CashbookProgress
                            creating={cashbookBatch.creating}
                            status={cashbookStatus}
                            running={isBusy === "match"}
                        />
                    )}
                </div>

                {/* ⚠️ THE CASHBOOK FOOTER IS PINNED, the Cashfree one is not, and that is not an
                    inconsistency left lying around. Cashfree's actions are rendered by
                    `StatementPreview` INSIDE the scrolling body, which is where they have always
                    been -- moving them would restructure a screen that settles money for no reason
                    this slice needs. Cashbook's body is a fourteen-group tree that is MEANT to be
                    scrolled, so its confirm button has to stay put while you scroll it. */}
                {isCashbook && (cashbookPreview || cashbookBatch) && (
                    <div className="flex shrink-0 items-center justify-end gap-2 border-t px-6 py-3">
                        {cashbookBatch ? (
                            <Button onClick={handleCashbookDone} disabled={isBusy === "match"}>
                                {isBusy === "match" && (
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                )}
                                {isBusy === "match" ? "Creating…" : "Done"}
                            </Button>
                        ) : (
                            <>
                                <Button
                                    variant="outline"
                                    disabled={working}
                                    onClick={() => inputRef.current?.click()}
                                >
                                    Choose another file
                                </Button>
                                <Button
                                    onClick={handleCashbookConfirm}
                                    disabled={working || !cashbookPreview?.creating}
                                >
                                    {isBusy === "upload" && (
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    )}
                                    {createLabel(cashbookPreview?.creating ?? 0)}
                                </Button>
                            </>
                        )}
                    </div>
                )}

                {/* ⚠️ THE CASHFREE FOOTER EXISTS ONLY FROM STEP 3 ON (slice CF/S7). Steps 1 and 2
                    keep their in-body buttons, which is where they have always been -- moving them
                    would restructure a screen that settles money for no reason this slice needs.
                    From step 3 the body is a staged summary or an 800-row vendor tree that is MEANT
                    to be scrolled, so the way OUT has to stay put while you scroll it. */}
                {!isCashbook && stepIndex >= 2 && (
                    <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t px-6 py-3">
                        {/* ⚠️ IT SAYS THE ROWS ARE ALREADY IN. By this point closing loses nothing,
                            and a reviewer who cannot tell that will sit through an 800-row confirm
                            they did not want to start -- or close it fearing they undid the
                            import. */}
                        <p className="max-w-md text-xs text-muted-foreground">
                            {FINISH_LATER_NOTE}
                        </p>
                        <div className="flex items-center gap-2">
                            {/* Re-run reaches every OPEN import, not only this statement -- the
                                point being that a payment approved since the last run may belong to
                                an older one. */}
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={handleRematchOpenImports}
                                disabled={rematching || locked}
                            >
                                {rematching ? (
                                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                                ) : (
                                    <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                                )}
                                Re-run match
                            </Button>
                            <Button
                                size="sm"
                                variant={onConfirmStep ? "outline" : "default"}
                                onClick={() => onOpenChange(false)}
                                disabled={locked}
                            >
                                Finish later
                            </Button>
                        </div>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
};

/**
 * What importing this statement would do, shown before anything is written.
 *
 * ⚠️ REFUSED AND WARNED ARE DIFFERENT SHAPES, not one message with two tones. A refusal removes
 * the confirm button entirely -- there is genuinely nothing to create. A warning KEEPS it and says
 * how few rows are new, because a warning never blocks (owner ruling Q2). Collapsing the two would
 * either block an import the owner said must be possible, or offer a button that creates nothing.
 */
const StatementPreview = ({
    preview,
    busy,
    phase,
    onConfirm,
    onChooseAnother,
}: {
    preview: OutflowPreviewResult;
    busy: boolean;
    phase: "preview" | "upload" | "match" | null;
    onConfirm: () => void;
    onChooseAnother: () => void;
}) => {
    const counts = previewCounts(preview);
    const debit = statementDebit(preview);
    return (
    <div className="space-y-4 rounded-md border bg-muted/30 p-4">
        {/* Two columns, two questions: what is IN this file, and what LEFT the bank. They are
            different kinds of fact and the reviewer checks them against different things -- the
            counts against the export they downloaded, the money against the account. */}
        <div className="grid gap-x-10 gap-y-5 sm:grid-cols-2">
            <section className="space-y-1.5">
                <SectionLabel>In this file</SectionLabel>
                {/* ⚠️ `dd-MMM-yyyy` VIA `formatDate`, THE APP-WIDE RULE (frontend/CLAUDE.md). The
                    server sends the period as ISO (`2026-05-02`) because that is what a date column
                    holds; every screen in this app renders `02-May-2026`, and a dialog that shows
                    the raw ISO is the one place an accountant has to re-read a date to be sure
                    which way round it is. */}
                <PreviewFigure
                    label="Period"
                    value={
                        preview.period_from
                            ? preview.period_to && preview.period_to !== preview.period_from
                                ? `${formatDate(preview.period_from)} to ${formatDate(preview.period_to)}`
                                : formatDate(preview.period_from)
                            : "not dated"
                    }
                />
                <PreviewFigure label="Transfers" value={String(counts.total)} />
                <PreviewFigure label="Successful" value={String(counts.successful)} />
                {/* ⚠️ SHOWN ONLY WHEN THERE ARE ANY, AND CALLED OUT AS EXCLUDED. A failed transfer
                    is money the bank refused to move: it is already out of Gross Outflow, and
                    after import it is out of every figure the summary panel reports. Saying so
                    here is what stops the counts below looking like they do not add up. */}
                {counts.failed > 0 && (
                    <PreviewFigure
                        label="Failed at the bank"
                        value={`${counts.failed} — excluded`}
                        tone="muted"
                    />
                )}
                {counts.duplicates > 0 && (
                    <PreviewFigure
                        label="Already imported"
                        value={`${counts.duplicates} — will be skipped`}
                        tone="amber"
                    />
                )}
            </section>

            {/* ⚠️ THE MONEY COLUMN FOOTS, THE WAY A BANK STATEMENT'S OWN SUMMARY BLOCK DOES, and
                that rule above the total is the point of this block. Gross and charges were shown
                as two unrelated figures; they are not. The bank takes its fee whatever a transfer's
                outcome, so their SUM is the debit the accountant reconciles against the account --
                the one number this dialog never showed. */}
            <section className="space-y-1.5">
                <SectionLabel>Left the bank</SectionLabel>
                <PreviewFigure
                    label="Gross Outflow"
                    value={formatToRoundedIndianRupee(debit.gross)}
                />
                <PreviewFigure
                    label="Bank charges"
                    value={formatToRoundedIndianRupee(debit.charges)}
                />
                <div className="mt-1 border-t pt-1.5">
                    <PreviewFigure
                        label="Total debited"
                        value={formatToRoundedIndianRupee(debit.total)}
                        emphasis
                    />
                </div>
                {counts.failed > 0 && (
                    <p className="pt-0.5 text-xs text-muted-foreground">
                        Gross Outflow excludes the {counts.failed} failed{" "}
                        {counts.failed === 1 ? "transfer" : "transfers"}.
                    </p>
                )}
            </section>
        </div>

        {preview.duplicate_message && (
            <p
                className={
                    preview.refused || preview.warn
                        ? "text-sm text-amber-700"
                        : "text-sm text-muted-foreground"
                }
            >
                {preview.duplicate_message}
            </p>
        )}

        {/* An overlapping period is a WARNING, never a block -- two statements can share dates
            without sharing a single transfer. The precise guard is per-transfer. */}
        {preview.overlaps_batch && preview.overlaps_batch !== preview.duplicate_of_batch && (
            <p className="text-sm text-amber-700">
                This period overlaps an earlier import.
            </p>
        )}

        {preview.warnings.length > 0 && (
            <ul className="list-inside list-disc space-y-1 text-sm text-muted-foreground">
                {preview.warnings.map((w) => (
                    <li key={w}>{w}</li>
                ))}
            </ul>
        )}

        <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={onChooseAnother} disabled={busy}>
                Choose another file
            </Button>
            {!preview.refused && (
                <Button size="sm" onClick={onConfirm} disabled={busy}>
                    {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {phase === "upload"
                        ? "Importing…"
                        : phase === "match"
                          ? "Matching…"
                          : preview.warn
                            ? `Import the ${preview.new_rows} new ${
                                  preview.new_rows === 1 ? "transfer" : "transfers"
                              }`
                            : `Import ${preview.total_rows} transfers`}
                </Button>
            )}
        </div>
    </div>
    );
};

const SectionLabel = ({ children }: { children: ReactNode }) => (
    <div className="whitespace-nowrap text-xs uppercase tracking-wide text-muted-foreground">
        {children}
    </div>
);

/**
 * One label against one right-aligned value, on ONE line.
 *
 * ⚠️ BOTH SIDES ARE `whitespace-nowrap` (owner ruling 2026-08-10). A wrapped label and a wrapped
 * rupee figure were what made this block read as broken -- and `justify-between` hides the problem
 * until the value is long, which is exactly when the reviewer is reading it most carefully. The
 * dialog is `max-w-3xl` so nowrap stays a layout rule rather than turning into overflow.
 */
const PreviewFigure = ({
    label,
    value,
    tone,
    emphasis,
}: {
    label: string;
    value: string;
    tone?: "muted" | "amber";
    emphasis?: boolean;
}) => (
    <div className="flex items-baseline justify-between gap-6 text-sm">
        <span
            className={`whitespace-nowrap ${
                tone === "amber" ? "text-amber-700" : "text-muted-foreground"
            }`}
        >
            {label}
        </span>
        <span
            className={`whitespace-nowrap tabular-nums ${
                emphasis ? "text-base font-semibold" : "font-medium"
            } ${tone === "amber" ? "text-amber-700" : tone === "muted" ? "text-muted-foreground" : ""}`}
        >
            {value}
        </span>
    </div>
);

/**
 * Shown between the upload landing and the match finishing.
 *
 * It exists for the seconds in between, and for the case where the match FAILED -- the dialog stays
 * open with the error above, and this panel is what says the rows are nonetheless imported.
 */
const StagedSummary = ({
    result,
    matching,
}: {
    result: OutflowUploadResult;
    matching: boolean;
}) => (
    <div className="space-y-2 rounded-md border bg-muted/30 p-4">
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-sm">
            <span className="flex items-center gap-1.5 font-medium">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                {result.total_rows} transfers imported
            </span>
            {result.skipped_rows > 0 && (
                <span className="text-muted-foreground">
                    {result.skipped_rows} skipped automatically
                </span>
            )}
        </div>
        {matching && (
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Matching them against approved payments and expenses…
            </p>
        )}
        {result.warnings.length > 0 && (
            <ul className="list-inside list-disc space-y-1 text-sm text-muted-foreground">
                {result.warnings.map((w) => (
                    <li key={w}>{w}</li>
                ))}
            </ul>
        )}
    </div>
);

/**
 * The real reason a RAW-FETCH upload failed.
 *
 * ⚠️ THIS PATH IS A BARE `fetch`, NOT THE SDK, so it holds the response BODY as text rather than a
 * thrown error object -- which is why it cannot simply call `describeFrappeError` on an exception.
 * It parses the body and then hands the parsed envelope to that same shared helper, so both paths
 * produce the same sentence for the same server refusal. Do NOT let the two drift back apart: the
 * previous local version read only `list[0].message` and dropped titles, later messages, and the
 * exception fallback entirely.
 */
function extractServerMessage(payload: string): string | null {
    try {
        const parsed = JSON.parse(payload);
        const described = describeFrappeError(parsed, "");
        return described || null;
    } catch {
        return null;
    }
}

/**
 * What the background job is doing, and what it did.
 *
 * ⚠️ THE FINISHED LINE REPORTS WHAT HAPPENED, NEVER THE POPULATION. A run with three failures must
 * say so on the same line that says it finished -- "Created 115 records" beside three quiet
 * failures is the shape that gets failures ignored. `progressText` owns that wording so both halves
 * of it stay testable without a browser.
 */
const CashbookProgress = ({
    creating,
    status,
    running,
}: {
    creating: number;
    status: CashbookStatus | null;
    running: boolean;
}) => {
    const fraction = progressFraction(status, creating);
    const failed = (status?.failed ?? 0) > 0;
    return (
        <div className="space-y-3 rounded-md border bg-muted/30 p-4">
            <div className="flex items-center gap-2 text-sm">
                {running ? (
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
                ) : (
                    <CheckCircle2
                        className={`h-4 w-4 shrink-0 ${
                            failed ? "text-amber-600" : "text-emerald-600"
                        }`}
                    />
                )}
                <span className={failed && !running ? "text-amber-700 dark:text-amber-500" : ""}>
                    {progressText(status, creating)}
                </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                    className={`h-full rounded-full transition-[width] duration-300 ${
                        failed ? "bg-amber-500" : "bg-emerald-600"
                    }`}
                    style={{ width: `${Math.round(fraction * 100)}%` }}
                />
            </div>
            {!running && (
                <p className="text-xs text-muted-foreground">
                    Corrections are made in Expenses — open a record and change its project or type.
                </p>
            )}
        </div>
    );
};
