import { useState } from "react";
import { ExternalLink, ImageIcon } from "lucide-react";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import SITEURL from "@/constants/siteURL";

/** The file name of a stored attachment: the storage URL's `file_name` param, else the path's last segment. */
const fileNameOf = (url: string) => {
    const [path, query = ""] = url.split("?");
    return new URLSearchParams(query).get("file_name") || path.split("/").pop() || "";
};

const isPdf = (url: string) => /\.pdf$/i.test(fileNameOf(url));

/** A Cheque's photo shown inline: the image, or the PDF in a frame. */
export const ChequePhoto = ({ url, chequeNo, className }: { url: string; chequeNo?: string; className?: string }) => {
    const href = `${SITEURL}${url}`;
    return isPdf(url) ? (
        <iframe src={href} title={`Cheque ${chequeNo ?? ""}`} className={className ?? "h-[70vh] w-full rounded border"} />
    ) : (
        <img
            src={href}
            alt={`Cheque ${chequeNo ?? ""}`}
            className={className ?? "max-h-[70vh] w-full rounded border object-contain"}
        />
    );
};

interface ChequePhotoLinkProps {
    /** The Cheque's `attachment` file URL; a backfilled Cheque has none. */
    url?: string | null;
    chequeNo?: string;
}

/**
 * "View" for a Cheque's photo: opens a preview dialog (the image, or the PDF inline) with a link to
 * open the file in a new tab. Shows "--" when the Cheque has no photo.
 */
export const ChequePhotoLink = ({ url, chequeNo }: ChequePhotoLinkProps) => {
    const [open, setOpen] = useState(false);
    if (!url) return <span className="text-muted-foreground">--</span>;
    const href = `${SITEURL}${url}`;

    return (
        <>
            <button
                type="button"
                onClick={() => setOpen(true)}
                className="inline-flex items-center gap-1 text-blue-600 hover:underline"
                aria-label={`Preview the photo of cheque ${chequeNo ?? ""}`}
            >
                <ImageIcon className="h-3.5 w-3.5" />
                View
            </button>
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="max-w-3xl">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-3 text-base">
                            Cheque {chequeNo}
                            <a
                                href={href}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-sm font-normal text-blue-600 hover:underline"
                            >
                                Open in new tab <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                        </DialogTitle>
                    </DialogHeader>
                    {open && <ChequePhoto url={url} chequeNo={chequeNo} />}
                </DialogContent>
            </Dialog>
        </>
    );
};
