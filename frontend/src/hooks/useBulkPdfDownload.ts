import { useState, useContext, useCallback, useEffect, useRef } from "react";
import { useToast } from "@/components/ui/use-toast";
import { FrappeContext, FrappeConfig } from "frappe-react-sdk";
import { useUserData } from "@/hooks/useUserData";
import { BulkDocType, BulkDownloadScope } from "@/utils/bulkDownload/bulkDownloadTypes";
import { cancelBulkDownload, listenForDownload, newDownloadId } from "@/utils/bulkDownload/bulkDownloadEvents";

export type DownloadType = BulkDocType;

/** Quick Download ("download all") for one project or one vendor. */
export const useBulkPdfDownload = (scope: BulkDownloadScope) => {
    const { toast } = useToast();
    const { socket } = useContext(FrappeContext) as FrappeConfig;
    const { role } = useUserData();
    const isProjectManager = role === "Nirmaan Project Manager Profile";

    const [loading, setLoading] = useState(false);
    const [showProgress, setShowProgress] = useState(false);
    const [progress, setProgress] = useState(0);
    const [progressMessage, setProgressMessage] = useState("");
    
    const [downloadToken, setDownloadToken] = useState<{ token: string, filename: string } | null>(null);

    // The download this button started: its id, and the function that removes its listeners.
    const activeIdRef = useRef<string | null>(null);
    const unlistenRef = useRef<(() => void) | null>(null);
    const detach = useCallback(() => {
        unlistenRef.current?.();
        unlistenRef.current = null;
        activeIdRef.current = null;
    }, []);

    // PO/WO rate-selection dialog (shared)
    const [showRateDialog, setShowRateDialog] = useState(false);
    const [rateDocType, setRateDocType] = useState<"PO" | "WO">("PO");
    const [withRate, setWithRate] = useState(true);

    // Invoice specific
    const [showInvoiceDialog, setShowInvoiceDialog] = useState(false);
    const [invoiceType, setInvoiceType] = useState<string>("All Invoices");

    const initiatePODownload = () => {
        setRateDocType("PO");
        setShowRateDialog(true);
        setWithRate(true);
    };

    const initiateWODownload = () => {
        setRateDocType("WO");
        setShowRateDialog(true);
        setWithRate(true);
    };

    const initiateInvoiceDownload = () => {
        setShowInvoiceDialog(true);
        setInvoiceType("All Invoices");
    };

    const triggerDownload = useCallback((token: string, filename: string) => {
        const url = `/api/method/nirmaan_stack.api.pdf_helper.bulk_download.fetch_temp_file?token=${token}&filename=${encodeURIComponent(filename)}`;
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }, []);

    const stopProgress = useCallback(() => {
        setLoading(false);
        setShowProgress(false);
        detach();
    }, [detach]);

    /** The progress window's Cancel: close it and tell the server to stop the job. */
    const cancelDownload = useCallback(() => {
        const id = activeIdRef.current;
        stopProgress();
        setDownloadToken(null);
        if (id) cancelBulkDownload(id);
        toast({ title: "Download cancelled" });
    }, [stopProgress, toast]);

    // Leaving the page mid-download stops the job too: nobody would receive the file.
    useEffect(() => () => {
        const id = activeIdRef.current;
        unlistenRef.current?.();
        if (id) cancelBulkDownload(id);
    }, []);

    // Full Auto-Completion Logic
    useEffect(() => {
        if (!loading) return;
        if (downloadToken) {
            triggerDownload(downloadToken.token, downloadToken.filename);
            stopProgress();
        }
    }, [downloadToken, loading, triggerDownload, stopProgress]);

    const handleBulkDownload = async (type: DownloadType, label: string, options?: any) => {
        try {
            if (type === "PO" || type === "WO") setShowRateDialog(false);
            if (type === "Invoice") setShowInvoiceDialog(false);

            setLoading(true);
            setShowProgress(true);
            setProgress(0);
            setProgressMessage(`Starting ${label} download...`);
            setDownloadToken(null);

            detach();
            const downloadId = newDownloadId();
            activeIdRef.current = downloadId;
            if (socket) {
                unlistenRef.current = listenForDownload(socket, downloadId, {
                    onProgress: (data) => {
                        if (data.progress !== undefined) setProgress(data.progress);
                        if (data.message) setProgressMessage(data.message);
                    },
                    onReady: (data) => setDownloadToken(data),
                    onFailed: (data) => {
                        toast({ title: "Download Failed", description: data.message, variant: "destructive" });
                        stopProgress();
                    },
                });
            }

            const formData = new FormData();
            formData.append(scope.kind, scope.id);
            formData.append("download_id", downloadId);

            let endpoint = "";

            switch (type) {
                case "PO":
                    const effectiveWithRate = isProjectManager ? false : !!options?.withRate;
                    endpoint = `/api/method/nirmaan_stack.api.pdf_helper.bulk_download.download_all_pos`;
                    formData.append("with_rate", effectiveWithRate ? "1" : "0");
                    break;
                case "WO":
                    const woWithRate = isProjectManager ? false : !!options?.withRate;
                    endpoint = `/api/method/nirmaan_stack.api.pdf_helper.bulk_download.download_all_wos`;
                    formData.append("with_rate", woWithRate ? "1" : "0");
                    break;
                case "Invoice":
                    const invType = options?.invoiceType || invoiceType;
                    endpoint = `/api/method/nirmaan_stack.api.pdf_helper.bulk_download.download_project_attachments`;
                    formData.append("doc_type", invType);
                    break;
                case "DC":
                    endpoint = `/api/method/nirmaan_stack.api.pdf_helper.bulk_download.download_project_attachments`;
                    formData.append("doc_type", "DC");
                    break;
                case "MIR":
                    endpoint = `/api/method/nirmaan_stack.api.pdf_helper.bulk_download.download_project_attachments`;
                    formData.append("doc_type", "MIR");
                    break;
                case "DN":
                    endpoint = `/api/method/nirmaan_stack.api.pdf_helper.bulk_download.download_all_dns`;
                    break;
                case "ClientInvoice":
                    endpoint = `/api/method/nirmaan_stack.api.pdf_helper.bulk_download.download_project_attachments`;
                    formData.append("doc_type", "Client Invoices");
                    break;
                case "PaymentVoucher":
                    endpoint = `/api/method/nirmaan_stack.api.pdf_helper.bulk_download.download_project_attachments`;
                    formData.append("doc_type", "Payment Vouchers");
                    break;
                case "MTC":
                    endpoint = `/api/method/nirmaan_stack.api.pdf_helper.bulk_download.download_project_attachments`;
                    formData.append("doc_type", "MTCs");
                    break;
            }

            const response = await fetch(endpoint, {
                method: "POST",
                headers: {
                    "X-Frappe-CSRF-Token": (window as any).csrf_token || "",
                },
                body: formData,
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.message || `Failed to start ${label} download (Status: ${response.status})`);
            }

            toast({ title: "Processing Started", description: "Your documents are being prepared in the background." });

        } catch (error: any) {
            toast({ title: "Error", description: error.message, variant: "destructive" });
            stopProgress();
        }
    };

    return {
        loading,
        showProgress,
        setShowProgress,
        progress,
        progressMessage,
        showRateDialog,
        setShowRateDialog,
        rateDocType,
        withRate,
        setWithRate,
        initiatePODownload,
        initiateWODownload,
        showInvoiceDialog,
        setShowInvoiceDialog,
        invoiceType,
        setInvoiceType,
        initiateInvoiceDownload,
        handleBulkDownload,
        downloadToken,
        triggerDownload,
        stopProgress,
        cancelDownload,
    };
};
