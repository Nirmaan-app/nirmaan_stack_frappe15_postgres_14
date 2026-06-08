// In-app preview of a commission report rendered from the server print format.
// The PDF is fetched as a blob and shown in an iframe with the native PDF
// toolbar hidden (#toolbar=0), so there is NO download/print in preview.
// A Download button is shown only when `canDownload` (post-approval).

import React, { useEffect, useState } from 'react';
import { Loader2, Download, AlertTriangle } from 'lucide-react';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** PDF url. For a generated print format use the download_pdf endpoint; for an
     *  already-served file (uploaded PDF) pass its file url + set `directSrc`. */
    pdfUrl: string;
    /** Render the url straight in the iframe (no blob fetch). Use for served files
     *  to avoid CORS/attachment issues. */
    directSrc?: boolean;
    title?: string;
    fileName?: string;
    canDownload?: boolean;
}

export const ReportPreviewDialog: React.FC<Props> = ({
    open,
    onOpenChange,
    pdfUrl,
    directSrc = false,
    title = 'Report Preview',
    fileName = 'report.pdf',
    canDownload = false,
}) => {
    const [blobUrl, setBlobUrl] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(false);

    useEffect(() => {
        if (!open || directSrc) return;   // directSrc renders straight in the iframe
        let revoked = false;
        let currentUrl: string | null = null;
        setLoading(true);
        setError(false);

        // Same-origin fetch (dev proxy / prod same host) carries the session cookie.
        fetch(pdfUrl, { credentials: 'include' })
            .then((res) => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return res.blob();
            })
            .then((blob) => {
                if (revoked) return;
                currentUrl = URL.createObjectURL(blob);
                setBlobUrl(currentUrl);
            })
            .catch(() => !revoked && setError(true))
            .finally(() => !revoked && setLoading(false));

        return () => {
            revoked = true;
            if (currentUrl) URL.revokeObjectURL(currentUrl);
            setBlobUrl(null);
        };
    }, [open, pdfUrl, directSrc]);

    // Final iframe source: served file directly, or the fetched blob.
    const viewerSrc = directSrc
        ? (pdfUrl ? `${pdfUrl}#toolbar=0&navpanes=0` : null)
        : (blobUrl ? `${blobUrl}#toolbar=0&navpanes=0` : null);
    const downloadHref = directSrc ? pdfUrl : blobUrl;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-5xl w-[95vw] p-0 gap-0">
                <DialogHeader className="px-4 py-3 border-b">
                    <DialogTitle className="text-base font-semibold">{title}</DialogTitle>
                </DialogHeader>

                <div className="bg-gray-100">
                    {loading && !directSrc && (
                        <div className="flex items-center justify-center h-[78vh] text-gray-400">
                            <Loader2 className="h-6 w-6 animate-spin" />
                        </div>
                    )}
                    {error && !directSrc && (
                        <div className="flex flex-col items-center justify-center h-[78vh] text-red-600 gap-2">
                            <AlertTriangle className="h-6 w-6" />
                            <p className="text-sm">Could not load the report preview.</p>
                        </div>
                    )}
                    {viewerSrc && !(error && !directSrc) && (
                        <iframe
                            title="Report preview"
                            src={viewerSrc}
                            className="w-full h-[78vh] border-0"
                        />
                    )}
                </div>

                <DialogFooter className="px-4 py-3 border-t gap-2 sm:gap-2">
                    {canDownload && downloadHref ? (
                        <a href={downloadHref} download={fileName} target="_blank" rel="noopener noreferrer">
                            <Button size="sm" className="gap-1">
                                <Download className="h-3.5 w-3.5" /> Download
                            </Button>
                        </a>
                    ) : (
                        <span className="text-[11px] text-gray-400 self-center mr-auto">
                            Download is available after approval.
                        </span>
                    )}
                    <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Close</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
