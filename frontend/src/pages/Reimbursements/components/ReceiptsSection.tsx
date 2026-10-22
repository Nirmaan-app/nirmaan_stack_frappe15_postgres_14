/**
 * "Receipts" in the Raise dialog: drop or choose any files; pictures show a preview.
 *
 * Each file is marked with what happens to it on submit (`isMergeable`, the twin of the server's
 * `receipts.is_mergeable`): PDFs and pictures are merged into the claim's one receipts PDF; anything else
 * is kept on the claim as it is. On an edit the receipts already on the claim are listed too, and any of
 * them can be removed.
 *
 * Kept compact so 10-20 files don't stretch the dialog: once a file is added the drop zone shrinks to one
 * line, files are small square tiles (the name on hover), and the tiles scroll inside their own box.
 */

import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { FileText, ImageIcon, Paperclip, Upload, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import SITEURL from "@/constants/siteURL";
import { cn } from "@/lib/utils";
import type { ClaimFile } from "@/types/NirmaanStack/Reimbursement";
import { isMergeable } from "@/utils/reimbursements/rules";

export const MAX_RECEIPTS = 20;

interface Props {
    files: File[];
    onFilesChange: (files: File[]) => void;
    /** On an edit: the receipts already on the claim, and the ones the person removed. */
    existing?: ClaimFile[];
    removed?: string[];
    onRemovedChange?: (urls: string[]) => void;
    disabled?: boolean;
    error?: string | null;
}

const isImage = (f: File) => f.type.startsWith("image/");

export function ReceiptsSection({ files, onFilesChange, existing = [], removed = [], onRemovedChange, disabled, error }: Props) {
    const input = useRef<HTMLInputElement>(null);
    const [over, setOver] = useState(false);

    // Object URLs for the picture previews, made once per file list.
    const previews = useMemo(() => files.map((f) => (isImage(f) ? URL.createObjectURL(f) : null)), [files]);
    useEffect(() => () => previews.forEach((url) => url && URL.revokeObjectURL(url)), [previews]);

    const kept = existing.filter((f) => !removed.includes(f.file_url));
    const mergedCount = files.filter((f) => isMergeable(f.name)).length + (kept.some((f) => f.is_receipts_pdf) ? 1 : 0);
    const separateCount = files.filter((f) => !isMergeable(f.name)).length + kept.filter((f) => !f.is_receipts_pdf).length;
    const total = files.length + kept.length;
    const full = files.length >= MAX_RECEIPTS;

    const add = (list: FileList | null) => {
        if (!list?.length) return;
        onFilesChange([...files, ...Array.from(list)].slice(0, MAX_RECEIPTS));
    };
    const onDrop = (e: DragEvent) => {
        e.preventDefault();
        setOver(false);
        if (!disabled && !full) add(e.dataTransfer.files);
    };
    const choose = (
        <button type="button" className="font-medium text-primary hover:underline disabled:opacity-50"
            onClick={() => input.current?.click()} disabled={disabled || full}>
            {total ? "add more" : "choose files"}
        </button>
    );

    return (
        <section className="flex flex-col gap-3" aria-labelledby="reimb-receipts-heading">
            <div>
                <h3 id="reimb-receipts-heading" className="text-sm font-semibold">
                    Receipts <span className="text-destructive">*</span>
                </h3>
                <p className="text-xs text-muted-foreground">PDFs and photos are merged into one PDF when you submit. Other files stay as they are.</p>
            </div>

            <div
                onDragOver={(e) => { e.preventDefault(); setOver(true); }}
                onDragLeave={() => setOver(false)}
                onDrop={onDrop}
                className={cn(
                    "rounded-lg border-2 border-dashed text-center transition-colors",
                    over ? "border-primary bg-primary/5" : "border-muted-foreground/25",
                    total
                        ? "flex items-center justify-between gap-2 px-3 py-2 text-sm"
                        : "flex flex-col items-center justify-center gap-2 px-4 py-6",
                )}
            >
                {total ? (
                    <>
                        <span className="flex items-center gap-2">
                            <Upload className="h-4 w-4 shrink-0 text-muted-foreground" />
                            <span>Drop files, or {choose}</span>
                        </span>
                        <span className="text-xs tabular-nums text-muted-foreground">{files.length} / {MAX_RECEIPTS}</span>
                    </>
                ) : (
                    <>
                        <Upload className="h-6 w-6 text-muted-foreground" />
                        <p className="text-sm">Drop files here, or {choose}</p>
                        <p className="text-xs text-muted-foreground">Bills, photos, screenshots. Up to {MAX_RECEIPTS} files.</p>
                    </>
                )}
                <input
                    ref={input}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={(e) => { add(e.target.files); e.target.value = ""; }}
                />
            </div>

            {total > 0 && (
                <div className="max-h-52 overflow-y-auto pr-1">
                    {kept.length > 0 && (
                        <ul className="mb-2 flex flex-col gap-1" aria-label="Receipts on this claim">
                            {kept.map((f) => (
                                <li key={f.file_url} className="flex items-center gap-2 rounded-md border px-2 py-1 text-xs">
                                    {f.is_receipts_pdf ? <FileText className="h-3.5 w-3.5 shrink-0 text-primary" /> : <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                                    <a href={`${SITEURL}${f.file_url}`} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate hover:underline">
                                        {f.is_receipts_pdf ? "Receipts PDF (on this claim)" : f.file_name}
                                    </a>
                                    <Button type="button" variant="ghost" size="sm" className="h-5 w-5 p-0" disabled={disabled}
                                        aria-label={`Remove ${f.file_name}`}
                                        onClick={() => onRemovedChange?.([...removed, f.file_url])}>
                                        <X className="h-3 w-3" />
                                    </Button>
                                </li>
                            ))}
                        </ul>
                    )}

                    {files.length > 0 && (
                        <ul className="grid grid-cols-4 gap-1.5 sm:grid-cols-5" aria-label="New receipts">
                            {files.map((f, i) => {
                                const merge = isMergeable(f.name);
                                return (
                                    <li key={`${f.name}-${i}`} title={`${f.name} · ${merge ? "merged into the PDF" : "kept separate"}`}
                                        className="relative aspect-square overflow-hidden rounded-md border bg-muted/40">
                                        {previews[i] ? (
                                            <img src={previews[i]!} alt={f.name} className="h-full w-full object-cover" />
                                        ) : (
                                            <div className="flex h-full flex-col items-center justify-center gap-1 p-1">
                                                {f.name.toLowerCase().endsWith(".pdf") ? (
                                                    <FileText className="h-5 w-5 text-primary" />
                                                ) : isImage(f) ? (
                                                    <ImageIcon className="h-5 w-5 text-muted-foreground" />
                                                ) : (
                                                    <Paperclip className="h-5 w-5 text-muted-foreground" />
                                                )}
                                                <span className="w-full truncate text-center text-[10px] leading-tight">{f.name}</span>
                                            </div>
                                        )}
                                        {!merge && (
                                            <span className="absolute inset-x-0 bottom-0 bg-background/90 text-center text-[10px] text-muted-foreground">
                                                Separate
                                            </span>
                                        )}
                                        <button
                                            type="button"
                                            disabled={disabled}
                                            aria-label={`Remove ${f.name}`}
                                            onClick={() => onFilesChange(files.filter((_, j) => j !== i))}
                                            className="absolute right-0.5 top-0.5 rounded-full bg-background/90 p-0.5 shadow hover:bg-background"
                                        >
                                            <X className="h-3 w-3" />
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </div>
            )}

            {total > 0 && (
                <p className="text-xs text-muted-foreground">
                    {mergedCount > 0 ? `${mergedCount} file${mergedCount === 1 ? "" : "s"} into one PDF` : "No PDF or photo to merge"}
                    {separateCount > 0 ? ` · ${separateCount} kept separate` : ""}
                </p>
            )}
            {error && <p className="text-xs text-destructive">{error}</p>}
        </section>
    );
}
