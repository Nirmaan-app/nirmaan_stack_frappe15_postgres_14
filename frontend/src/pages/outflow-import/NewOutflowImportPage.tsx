// src/pages/outflow-import/NewOutflowImportPage.tsx

import { useCallback, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AlertTriangle, ArrowLeft, FileSpreadsheet, Loader2, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

export const NewOutflowImportPage = () => {
    const navigate = useNavigate();
    const inputRef = useRef<HTMLInputElement>(null);

    const [source, setSource] = useState("Cashfree");
    const [file, setFile] = useState<File | null>(null);
    const [isBusy, setIsBusy] = useState<"preview" | "upload" | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [preview, setPreview] = useState<OutflowPreviewResult | null>(null);
    const [result, setResult] = useState<OutflowUploadResult | null>(null);
    const [isDragging, setIsDragging] = useState(false);

    const acceptFile = useCallback((candidate: File | undefined | null) => {
        setError(null);
        setPreview(null);
        setResult(null);
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
        try {
            const message = (await post(UPLOAD_URL)) as OutflowUploadResult | undefined;
            if (!message?.batch) {
                setError("The server accepted the file but returned no batch.");
                return;
            }
            setResult(message);
        } catch (err: any) {
            setError(err?.message || "Upload failed.");
        } finally {
            setIsBusy(null);
        }
    }, [file, isBusy, post]);

    return (
        <div className="flex-1 space-y-4">
            <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => navigate("/bulk-import-outflow")}>
                    <ArrowLeft className="mr-1 h-4 w-4" />
                    Back
                </Button>
                <h2 className="text-xl font-bold tracking-tight">New Import</h2>
            </div>

            <Card className="max-w-3xl">
                <CardHeader>
                    <CardTitle className="text-base">Upload a bank statement</CardTitle>
                </CardHeader>
                <CardContent className="space-y-5">
                    <div className="space-y-2">
                        <Label htmlFor="outflow-source">Source</Label>
                        <Select value={source} onValueChange={setSource}>
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
                            acceptFile(e.dataTransfer.files?.[0]);
                        }}
                        onClick={() => inputRef.current?.click()}
                        className={`flex cursor-pointer flex-col items-center justify-center rounded-md border-2 border-dashed p-8 text-center transition-colors ${
                            isDragging ? "border-primary bg-primary/5" : "border-muted-foreground/25"
                        }`}
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
                                <FileSpreadsheet className="mb-2 h-8 w-8 text-primary" />
                                <p className="font-medium">{file.name}</p>
                                <p className="text-xs text-muted-foreground">
                                    {(file.size / 1024).toFixed(1)} KB - click to choose another
                                </p>
                            </>
                        ) : (
                            <>
                                <Upload className="mb-2 h-8 w-8 text-muted-foreground" />
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

                    {/* Parse -> preview -> confirm. The preview is where the detected period
                        appears, BEFORE anything is written -- it was always captured, it just
                        happened silently after the commit where nobody could see it. */}
                    {result ? (
                        <UploadSummary result={result} />
                    ) : preview ? (
                        <StatementPreview
                            preview={preview}
                            busy={isBusy === "upload"}
                            onConfirm={handleConfirm}
                            onChooseAnother={() => inputRef.current?.click()}
                        />
                    ) : (
                        <Button onClick={handlePreview} disabled={!file || isBusy !== null}>
                            {isBusy === "preview" && (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            )}
                            {isBusy === "preview" ? "Reading statement..." : "Read statement"}
                        </Button>
                    )}
                </CardContent>
            </Card>
        </div>
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
    onConfirm,
    onChooseAnother,
}: {
    preview: OutflowPreviewResult;
    busy: boolean;
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
                {preview.duplicate_of_batch && (
                    <>
                        {" "}
                        <Link
                            className="underline underline-offset-2"
                            to={`/bulk-import-outflow/${preview.duplicate_of_batch}`}
                        >
                            Open {preview.duplicate_of_batch}
                        </Link>
                    </>
                )}
            </p>
        )}

        {/* An overlapping period is a WARNING, never a block -- two statements can share dates
            without sharing a single transfer. The precise guard is per-transfer. */}
        {preview.overlaps_batch && preview.overlaps_batch !== preview.duplicate_of_batch && (
            <p className="text-sm text-amber-700">
                This period overlaps import{" "}
                <Link
                    className="underline underline-offset-2"
                    to={`/bulk-import-outflow/${preview.overlaps_batch}`}
                >
                    {preview.overlaps_batch}
                </Link>
                .
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
            <Button variant="outline" size="sm" onClick={onChooseAnother}>
                Choose another file
            </Button>
            {!preview.refused && (
                <Button size="sm" onClick={onConfirm} disabled={busy}>
                    {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {busy
                        ? "Importing..."
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

const UploadSummary = ({ result }: { result: OutflowUploadResult }) => (
    <div className="space-y-3 rounded-md border bg-muted/30 p-4">
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-sm">
            <span className="font-medium">{result.total_rows} transfers staged</span>
            {result.skipped_rows > 0 && (
                <span className="text-muted-foreground">
                    {result.skipped_rows} skipped automatically
                </span>
            )}
            {result.period_from && (
                <span className="text-muted-foreground">
                    {result.period_from}
                    {result.period_to && result.period_to !== result.period_from
                        ? ` to ${result.period_to}`
                        : ""}
                </span>
            )}
        </div>

        {/* An overlapping period is a WARNING, never a block -- two statements can share dates
            without sharing a single transfer. The precise duplicate guard is per-transfer and has
            already run, which is what the skipped count above reflects. */}
        {result.overlaps_batch && (
            <p className="text-sm text-amber-700">
                This period overlaps import{" "}
                <Link
                    className="underline underline-offset-2"
                    to={`/bulk-import-outflow/${result.overlaps_batch}`}
                >
                    {result.overlaps_batch}
                </Link>
                . Any transfer already imported there has been skipped.
            </p>
        )}

        {result.warnings.length > 0 && (
            <ul className="list-inside list-disc space-y-1 text-sm text-muted-foreground">
                {result.warnings.map((w) => (
                    <li key={w}>{w}</li>
                ))}
            </ul>
        )}

        <Button asChild size="sm">
            <Link to={`/bulk-import-outflow/${result.batch}`}>Review {result.batch}</Link>
        </Button>
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

export const Component = NewOutflowImportPage;
export default NewOutflowImportPage;
