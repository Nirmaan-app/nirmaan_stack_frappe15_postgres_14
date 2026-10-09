import { useState, useContext, useCallback, useEffect, useRef } from "react";
import { useToast } from "@/components/ui/use-toast";
import { FrappeContext, FrappeConfig } from "frappe-react-sdk";
import { useUserData } from "@/hooks/useUserData";
import { BulkDocType, BulkDownloadScope } from "@/utils/bulkDownload/bulkDownloadTypes";
import { BulkDownloadReadyEvent, cancelBulkDownload, listenForDownload, newDownloadId } from "@/utils/bulkDownload/bulkDownloadEvents";
import { DownloadRun, applyFailed, applyProgress, applyReady, isWorking, runDetails, startRun } from "@/utils/bulkDownload/bulkDownloadRun";
import { readFrappeError } from "@/utils/frappeErrors";

export type DownloadType = BulkDocType;

/** Quick Download ("download all") for one project or one vendor. */
export const useBulkPdfDownload = (scope: BulkDownloadScope) => {
    const { toast } = useToast();
    const { socket } = useContext(FrappeContext) as FrappeConfig;
    const { role } = useUserData();
    const isProjectManager = role === "Nirmaan Project Manager Profile";

    const [loading, setLoading] = useState(false);
    // What the progress window shows; it stays open on the outcome (ready / failed) until closed.
    const [run, setRun] = useState<DownloadRun | null>(null);
    const showProgress = run !== null && isWorking(run.status);

    const [downloadToken, setDownloadToken] = useState<BulkDownloadReadyEvent | null>(null);

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

    /** The job is over (file, failure or refusal): stop listening. The window keeps its outcome. */
    const stopProgress = useCallback(() => {
        setLoading(false);
        detach();
    }, [detach]);

    /** The finished window's Close. */
    const closeProgress = useCallback(() => setRun(null), []);

    /** The progress window's Cancel: close it and tell the server to stop the job. */
    const cancelDownload = useCallback(() => {
        const id = activeIdRef.current;
        stopProgress();
        setRun(null);
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

            const effectiveWithRate = isProjectManager ? false : !!options?.withRate;
            const invType = options?.invoiceType || invoiceType;
            setLoading(true);
            setRun(startRun(type, runDetails(type, { withRate: effectiveWithRate, invoiceType: invType })));
            setDownloadToken(null);

            detach();
            const downloadId = newDownloadId();
            activeIdRef.current = downloadId;
            if (socket) {
                unlistenRef.current = listenForDownload(socket, downloadId, {
                    onProgress: (data) => setRun((r) => r && applyProgress(r, data, Date.now())),
                    onReady: (data) => {
                        setRun((r) => r && applyReady(r, data));
                        setDownloadToken(data);
                    },
                    // The window shows the reason; no toast on top of it.
                    onFailed: (data) => {
                        setRun((r) => r && applyFailed(r, data));
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
                    endpoint = `/api/method/nirmaan_stack.api.pdf_helper.bulk_download.download_all_pos`;
                    formData.append("with_rate", effectiveWithRate ? "1" : "0");
                    break;
                case "WO":
                    endpoint = `/api/method/nirmaan_stack.api.pdf_helper.bulk_download.download_all_wos`;
                    formData.append("with_rate", effectiveWithRate ? "1" : "0");
                    break;
                case "Invoice":
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
                case "POPaymentVoucher":
                    endpoint = `/api/method/nirmaan_stack.api.pdf_helper.bulk_download.download_project_attachments`;
                    formData.append("doc_type", "PO Payment Vouchers");
                    break;
                case "WOPaymentVoucher":
                    endpoint = `/api/method/nirmaan_stack.api.pdf_helper.bulk_download.download_project_attachments`;
                    formData.append("doc_type", "WO Payment Vouchers");
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
                throw new Error(await readFrappeError(response, `Failed to start ${label} download (Status: ${response.status})`));
            }

        } catch (error: any) {
            toast({ title: "Error", description: error.message, variant: "destructive" });
            setRun(null);
            stopProgress();
        }
    };

    return {
        loading,
        showProgress,
        run,
        closeProgress,
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
