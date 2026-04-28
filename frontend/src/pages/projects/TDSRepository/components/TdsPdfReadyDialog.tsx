import React from 'react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download, ExternalLink, FileText } from 'lucide-react';

interface TdsPdfReadyDialogProps {
    isOpen: boolean;
    onClose: () => void;
    onDownload: () => void;
    blobUrl: string | null;
    filename: string;
    sizeBytes: number;
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
}) => {
    const handleOpenInNewTab = () => {
        if (!blobUrl) return;
        window.open(blobUrl, '_blank', 'noopener,noreferrer');
    };

    return (
        <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
            <DialogContent className="max-w-[420px] p-0 gap-0 overflow-hidden">
                <DialogHeader className="px-5 pt-5 pb-3 border-b">
                    <DialogTitle className="text-base font-semibold">
                        Pending TDS is ready
                    </DialogTitle>
                </DialogHeader>

                <div className="px-5 py-4">
                    <div className="flex items-center gap-3 p-3 bg-gray-50 border border-gray-200 rounded-md">
                        <div className="w-9 h-9 bg-red-100 rounded-md flex items-center justify-center flex-shrink-0">
                            <FileText className="w-[18px] h-[18px] text-red-600" />
                        </div>
                        <div className="min-w-0 flex-1">
                            <p
                                className="text-[13px] font-medium text-gray-900 truncate"
                                title={filename}
                            >
                                {filename}
                            </p>
                            <p className="text-[11px] text-gray-500 mt-0.5">
                                {formatSize(sizeBytes)} · PDF
                            </p>
                        </div>
                    </div>

                    <p className="text-[11px] text-gray-500 mt-3 leading-relaxed">
                        Preview in a new tab first — the file is only saved when you click Download.
                    </p>
                </div>

                <div className="flex items-center gap-2 px-5 py-3 bg-gray-50 border-t">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={onClose}
                        className="border-gray-300 text-gray-700 hover:bg-gray-100"
                    >
                        Close
                    </Button>
                    <div className="flex items-center gap-2 ml-auto">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={handleOpenInNewTab}
                            disabled={!blobUrl}
                            className="border-red-500 text-red-700 hover:bg-red-50"
                        >
                            <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
                            Preview
                        </Button>
                        <Button
                            size="sm"
                            onClick={onDownload}
                            disabled={!blobUrl}
                            className="bg-red-600 hover:bg-red-700 text-white"
                        >
                            <Download className="w-3.5 h-3.5 mr-1.5" />
                            Download
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
};

