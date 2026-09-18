import { useEffect, useRef, useState } from "react";
import { useFrappeGetCall } from "frappe-react-sdk";
import { Loader2 } from "lucide-react";
import { TruncatedText } from "@/components/common/TruncatedText";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import SITEURL from "@/constants/siteURL";
import { cn } from "@/lib/utils";
import type { VendorRefundRow } from "./useVendorRefunds";

interface SheetPreview {
    file_name: string;
    rows: string[][];
    total_rows: number;
}

/** The attachment's file name: the storage URL's `file_name` param, else the path's last segment. */
const attachmentFileName = (url: string) => {
    const [path, query = ""] = url.split("?");
    return new URLSearchParams(query).get("file_name") || path.split("/").pop() || "";
};

const isSpreadsheet = (url: string) => /\.(xlsx|csv)$/i.test(attachmentFileName(url));

/**
 * A refund's UTR, linked to its attachment. PDFs and images open in a new tab (the storage URL is served
 * inline); a spreadsheet -- an imported refund's bank statement -- would only download there, so it opens
 * in a preview dialog instead, with the refund's own statement row highlighted.
 */
export const RefundAttachmentLink = ({ refund, className }: { refund: VendorRefundRow; className?: string }) => {
    const [open, setOpen] = useState(false);
    const attachment = refund.refund_attachment;

    if (!attachment) return <TruncatedText text={refund.utr} fallback="--" className={className} />;

    const label = <TruncatedText text={refund.utr} fallback="View Attachment" className={className} />;

    if (!isSpreadsheet(attachment)) {
        return (
            <a href={`${SITEURL}${attachment}`} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
                {label}
            </a>
        );
    }

    return (
        <>
            <button type="button" onClick={() => setOpen(true)} className="text-left text-blue-600 hover:underline">
                {label}
            </button>
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="max-w-[90vw]">
                    {open && <SheetPreviewBody refund={refund} />}
                </DialogContent>
            </Dialog>
        </>
    );
};

const SheetPreviewBody = ({ refund }: { refund: VendorRefundRow }) => {
    const { data, isLoading, error } = useFrappeGetCall<{ message: SheetPreview }>(
        "nirmaan_stack.api.vendor_refunds.attachment_preview.get_refund_attachment_preview",
        { refund: refund.name },
        `refund-attachment-preview-${refund.name}`
    );
    const preview = data?.message;
    const utr = (refund.utr || "").trim();
    const firstMatchRef = useRef<HTMLTableRowElement | null>(null);

    useEffect(() => {
        firstMatchRef.current?.scrollIntoView({ block: "center" });
    }, [preview]);

    const columnCount = Math.max(0, ...(preview?.rows ?? []).map((row) => row.length));
    let matched = false;

    return (
        <>
            <DialogHeader>
                <DialogTitle className="text-base break-all">
                    {preview?.file_name || attachmentFileName(refund.refund_attachment || "")}
                </DialogTitle>
            </DialogHeader>
            {isLoading ? (
                <div className="flex justify-center py-10">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
            ) : error || !preview ? (
                <p className="py-6 text-sm text-red-600">{error?.message || "Could not load the attachment."}</p>
            ) : (
                <>
                    {preview.total_rows > preview.rows.length && (
                        <p className="text-xs text-muted-foreground">
                            Showing the first {preview.rows.length.toLocaleString("en-IN")} of{" "}
                            {preview.total_rows.toLocaleString("en-IN")} rows.
                        </p>
                    )}
                    <div className="max-h-[70vh] overflow-auto rounded border">
                        <table className="w-full border-collapse text-xs">
                            <tbody>
                                {preview.rows.map((row, i) => {
                                    const isMatch = Boolean(utr) && row.some((cell) => cell.includes(utr));
                                    const isFirstMatch = isMatch && !matched;
                                    if (isMatch) matched = true;
                                    return (
                                        <tr
                                            key={i}
                                            ref={isFirstMatch ? firstMatchRef : undefined}
                                            className={cn("border-b", isMatch && "bg-yellow-100")}
                                        >
                                            <td className="sticky left-0 bg-muted px-2 py-1 text-right text-muted-foreground">
                                                {i + 1}
                                            </td>
                                            {Array.from({ length: columnCount }, (_, j) => (
                                                <td
                                                    key={j}
                                                    title={row[j] || undefined}
                                                    className="max-w-[16rem] truncate whitespace-nowrap border-l px-2 py-1"
                                                >
                                                    {row[j] ?? ""}
                                                </td>
                                            ))}
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </>
            )}
        </>
    );
};
