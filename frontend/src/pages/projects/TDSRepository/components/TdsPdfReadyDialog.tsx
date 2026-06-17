// In-app preview of a generated "Pending" TDS report. The PDF blob is already in
// memory (object URL), so it is rendered straight in an iframe with the native PDF
// toolbar hidden (#toolbar=0) — the file is only saved when the user clicks
// Download. Mirrors the Commission Report preview (ReportPreviewDialog).

import React from 'react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download, FileText } from 'lucide-react';

interface TdsPdfReadyDialogProps {
    isOpen: boolean;
    onClose: () => void;
    onDownload: () => void;
    blobUrl: string | null;
    filename: string;
    sizeBytes: number;
    /** Only Admins can save the file. Non-admins get the inline preview only —
     *  Download and "Open in new tab" (which exposes the native PDF toolbar) are
     *  both hidden. */
    canDownload?: boolean;
}

const formatSize = (bytes: number): string => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
};

export const TdsPdfReadyDialog: React.FC<TdsPdfReadyDialogProps> = ({
    isOpen,
    onClose,
    onDownload,
    blobUrl,
    filename,
    sizeBytes,
    canDownload = false,
}) => {
    // Render the in-memory blob directly; hide the native PDF toolbar so there is
    // no download/print from the preview itself.
    const viewerSrc = blobUrl ? `${blobUrl}#toolbar=0&navpanes=0` : null;
    const sizeLabel = formatSize(sizeBytes);

    return (
        <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
            <DialogContent className="max-w-5xl w-[95vw] p-0 gap-0">
                <DialogHeader className="px-4 py-3 border-b">
                    <DialogTitle className="flex items-center gap-3 text-left">
                        <span className="w-9 h-9 bg-red-100 rounded-md flex items-center justify-center flex-shrink-0">
                            <FileText className="w-[18px] h-[18px] text-red-600" />
                        </span>
                        <span className="min-w-0">
                            <span className="block text-sm font-semibold text-gray-900 truncate" title={filename}>
                                {filename || 'Pending TDS report'}
                            </span>
                            <span className="block text-[11px] font-normal text-gray-500 mt-0.5">
                                {sizeLabel ? `${sizeLabel} · ` : ''}PDF
                                {canDownload ? ' · Saved only when you click Download' : ''}
                            </span>
                        </span>
                    </DialogTitle>
                </DialogHeader>

                <div className="bg-gray-100">
                    {viewerSrc ? (
                        <iframe
                            title="TDS report preview"
                            src={viewerSrc}
                            className="w-full h-[78vh] border-0"
                        />
                    ) : (
                        <div className="flex items-center justify-center h-[78vh] text-gray-400 text-sm">
                            Preparing preview…
                        </div>
                    )}
                </div>

                <DialogFooter className="px-4 py-3 border-t gap-2 sm:gap-2">
                    {!canDownload && (
                        <span className="text-[11px] text-gray-400 self-center mr-auto">
                            Download is available to Admins only.
                        </span>
                    )}
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={onClose}
                        className={`border-gray-300 text-gray-700 hover:bg-gray-100${canDownload ? ' mr-auto' : ''}`}
                    >
                        Close
                    </Button>
                    {canDownload && (
                        <Button
                            size="sm"
                            onClick={onDownload}
                            disabled={!blobUrl}
                            className="bg-red-600 hover:bg-red-700 text-white gap-1.5"
                        >
                            <Download className="w-3.5 h-3.5" />
                            Download
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
