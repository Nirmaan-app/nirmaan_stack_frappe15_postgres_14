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
import { OutflowUploadResult } from "@/types/NirmaanStack/OutflowImportBatch";

const UPLOAD_URL =
    "/api/method/nirmaan_stack.api.outflow_import.upload.upload_outflow_statement";

// Mirrors the server's own limits (api/outflow_import/upload.py). Client-side is a courtesy so a
// wrong file fails instantly; the endpoint is the boundary.
const ALLOWED_EXTENSIONS = [".csv"];
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
    const [isUploading, setIsUploading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<OutflowUploadResult | null>(null);
    const [isDragging, setIsDragging] = useState(false);

    const acceptFile = useCallback((candidate: File | undefined | null) => {
        setError(null);
        setResult(null);
        if (!candidate) return;

        const lower = candidate.name.toLowerCase();
        if (!ALLOWED_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
            setError("We support .csv statements only.");
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

    const handleUpload = useCallback(async () => {
        if (!file || isUploading) return;
        setIsUploading(true);
        setError(null);
        try {
            const body = new FormData();
            body.append("file", file, file.name);
            body.append("source", source);

            // Raw multipart fetch, not the SDK -- the file rides the same POST as the text field.
            // Do NOT set Content-Type: the browser must add the multipart boundary itself.
            const response = await fetch(UPLOAD_URL, {
                method: "POST",
                body,
                headers: { "X-Frappe-CSRF-Token": (window as any).csrf_token || "" },
            });

            if (!response.ok) {
                const text = await response.text();
                setError(extractServerMessage(text) || `Upload failed (${response.status}).`);
                return;
            }

            const json = (await response.json()) as { message?: OutflowUploadResult };
            if (!json?.message?.batch) {
                setError("The server accepted the file but returned no batch.");
                return;
            }
            setResult(json.message);
        } catch (err: any) {
            setError(err?.message || "Upload failed.");
        } finally {
            setIsUploading(false);
        }
    }, [file, isUploading, source]);

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
                            accept=".csv"
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
                                <p className="font-medium">Drop a .csv statement here</p>
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

                    {result ? (
                        <UploadSummary result={result} />
                    ) : (
                        <Button onClick={handleUpload} disabled={!file || isUploading}>
                            {isUploading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            {isUploading ? "Reading statement..." : "Upload and stage"}
                        </Button>
                    )}
                </CardContent>
            </Card>
        </div>
    );
};

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
