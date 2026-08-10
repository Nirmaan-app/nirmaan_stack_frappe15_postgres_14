// src/pages/outflow-import/components/ImportStatementDialog.tsx

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Loader2, Upload } from "lucide-react";
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
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";

const PREVIEW_URL =
    "/api/method/nirmaan_stack.api.outflow_import.upload.preview_outflow_statement";
const UPLOAD_URL =
    "/api/method/nirmaan_stack.api.outflow_import.upload.upload_outflow_statement";

// Mirrors the server's own limits (api/outflow_import/upload.py). Client-side is a courtesy so a
// wrong file fails instantly; the endpoint is the boundary.
// .xlsx joins .csv at Q10 -- the server sniffs the real format from the bytes, so a renamed export
// still works and this list only decides what we accept by name.
const ALLOWED_EXTENSIONS = [".csv", ".xlsx"];
const MAX_FILE_BYTES = 5 * 1024 * 1024;

/** Only sources the backend parser actually has an adapter for may be selected. */
const SOURCES = [
    { value: "Cashfree", label: "Cashfree", available: true },
    { value: "Cashbook", label: "Cashbook (coming soon)", available: false },
];

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Called once the import is staged AND matched, with the new batch's name. */
    onImported: (batch: string) => void;
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
export const ImportStatementDialog = ({ open, onOpenChange, onImported }: Props) => {
    const inputRef = useRef<HTMLInputElement>(null);

    const [source, setSource] = useState("Cashfree");
    const [file, setFile] = useState<File | null>(null);
    const [isBusy, setIsBusy] = useState<"preview" | "upload" | "match" | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [preview, setPreview] = useState<OutflowPreviewResult | null>(null);
    const [staged, setStaged] = useState<OutflowUploadResult | null>(null);
    const [isDragging, setIsDragging] = useState(false);

    const { call: runMatch } = useFrappePostCall(
        "nirmaan_stack.api.outflow_import.review.match_batch"
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
    }, [open]);

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
        try {
            const message = (await post(PREVIEW_URL)) as OutflowPreviewResult | undefined;
            if (!message?.preview) {
                setError("The server read the file but returned no preview.");
                return;
            }
            setPreview(message);
        } catch (err: any) {
            setError(err?.message || "Could not read this statement.");
        } finally {
            setIsBusy(null);
        }
    }, [file, isBusy, post]);

    const handleConfirm = useCallback(async () => {
        if (!file || isBusy) return;
        setIsBusy("upload");
        setError(null);

        let batch: string;
        try {
            const message = (await post(UPLOAD_URL)) as OutflowUploadResult | undefined;
            if (!message?.batch) {
                setError("The server accepted the file but returned no batch.");
                setIsBusy(null);
                return;
            }
            setStaged(message);
            batch = message.batch;
        } catch (err: any) {
            setError(err?.message || "Upload failed.");
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
            setError(
                `The statement was imported, but matching it failed: ${
                    err?.message || "unknown error"
                }. Use “Re-run match” on the summary.`
            );
            setIsBusy(null);
            onImported(batch);
            return;
        }
        setIsBusy(null);
        onImported(batch);
        onOpenChange(false);
    }, [file, isBusy, post, runMatch, onImported, onOpenChange]);

    const working = isBusy === "upload" || isBusy === "match";

    return (
        <Dialog open={open} onOpenChange={(next) => (working ? null : onOpenChange(next))}>
            <DialogContent className="max-w-2xl">
                <DialogHeader>
                    <DialogTitle>Import a bank statement</DialogTitle>
                    <DialogDescription>
                        Transfers that have already left the bank. Nothing is settled by importing —
                        every row is confirmed by a person afterwards.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-5">
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

                    {error && (
                        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                            <span>{error}</span>
                        </div>
                    )}

                    {/* Parse -> preview -> confirm -> match. The preview is where the detected
                        period appears, BEFORE anything is written. */}
                    {staged ? (
                        <StagedSummary result={staged} matching={isBusy === "match"} />
                    ) : preview ? (
                        <StatementPreview
                            preview={preview}
                            busy={working}
                            phase={isBusy}
                            onConfirm={handleConfirm}
                            onChooseAnother={() => inputRef.current?.click()}
                        />
                    ) : (
                        <Button onClick={handlePreview} disabled={!file || isBusy !== null}>
                            {isBusy === "preview" && (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            )}
                            {isBusy === "preview" ? "Reading statement…" : "Read statement"}
                        </Button>
                    )}
                </div>
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
}) => (
    <div className="space-y-3 rounded-md border bg-muted/30 p-4">
        <div className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
            <PreviewFigure
                label="Period detected"
                value={
                    preview.period_from
                        ? preview.period_to && preview.period_to !== preview.period_from
                            ? `${preview.period_from} to ${preview.period_to}`
                            : preview.period_from
                        : "not dated"
                }
            />
            <PreviewFigure
                label="Transfers"
                value={
                    preview.failed_rows > 0
                        ? `${preview.total_rows} (${preview.successful_rows} successful, ${preview.failed_rows} failed)`
                        : String(preview.total_rows)
                }
            />
            <PreviewFigure
                label="Gross out"
                value={formatToRoundedIndianRupee(preview.gross_amount)}
            />
            <PreviewFigure
                label="Bank charges"
                value={formatToRoundedIndianRupee(preview.charges_amount)}
            />
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

const PreviewFigure = ({ label, value }: { label: string; value: string }) => (
    <div className="flex items-baseline justify-between gap-4 text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium tabular-nums">{value}</span>
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

/** Frappe returns its throw message inside `_server_messages`, a JSON array of JSON strings. */
function extractServerMessage(payload: string): string | null {
    try {
        const parsed = JSON.parse(payload);
        const messages = parsed?._server_messages;
        if (!messages) return parsed?.exception || null;
        const list = JSON.parse(messages) as string[];
        const first = JSON.parse(list[0]);
        return first?.message || null;
    } catch {
        return null;
    }
}
