import { useState, useContext, useCallback, useEffect } from "react";
import { useToast } from "@/components/ui/use-toast";
import { FrappeContext, FrappeConfig } from "frappe-react-sdk";
import { useUserData } from "@/hooks/useUserData";

export type DownloadType = "PO" | "WO" | "Invoice" | "DC" | "MIR" | "DN";

export const useBulkPdfDownload = (projectId: string, projectName?: string) => {
    const { toast } = useToast();
    const { socket } = useContext(FrappeContext) as FrappeConfig;
    const { role } = useUserData();
    const isProjectManager = role === "Nirmaan Project Manager Profile";

    const [loading, setLoading] = useState(false);
    const [showProgress, setShowProgress] = useState(false);
    const [progress, setProgress] = useState(0);
    const [progressMessage, setProgressMessage] = useState("");
    
    const [downloadToken, setDownloadToken] = useState<{ token: string, filename: string } | null>(null);

    // PO/WO specific
    const [showRateDialog, setShowRateDialog] = useState(false);
    const [withRate, setWithRate] = useState(true);

    // Invoice specific
    const [showInvoiceDialog, setShowInvoiceDialog] = useState(false);
    const [invoiceType, setInvoiceType] = useState<string>("All Invoices");

    const initiatePODownload = () => {
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
        if (socket) {
            ["bulk_download_progress", "bulk_download_all_ready", "bulk_download_failed"].forEach(ev => socket.off(ev));
        }
    }, [socket]);

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
            if (type === "PO") setShowRateDialog(false);
            if (type === "Invoice") setShowInvoiceDialog(false);

            setLoading(true);
            setShowProgress(true);
            setProgress(0);
            setProgressMessage(`Starting ${label} download...`);
            setDownloadToken(null);

            if (socket) {
                socket.on("bulk_download_progress", (data: any) => {
                    if (data.progress !== undefined) setProgress(data.progress);
                    if (data.message) setProgressMessage(data.message);
                });

                socket.on("bulk_download_all_ready", (data: any) => {
                    setDownloadToken(data);
                });

                socket.on("bulk_download_failed", (data: any) => {
                    toast({ title: "Download Failed", description: data.message, variant: "destructive" });
                    stopProgress();
                });
            }

            const formData = new FormData();
            formData.append("project", projectId);

            let endpoint = "";

            switch (type) {
                case "PO":
                    const effectiveWithRate = isProjectManager ? false : !!options?.withRate;
                    endpoint = `/api/method/nirmaan_stack.api.pdf_helper.bulk_download.download_all_pos`;
                    formData.append("with_rate", effectiveWithRate ? "1" : "0");
                    break;
                case "WO":
                    endpoint = `/api/method/nirmaan_stack.api.pdf_helper.bulk_download.download_all_wos`;
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
            setLoading(false);
            setShowProgress(false);
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
        withRate,
        setWithRate,
        initiatePODownload,
        showInvoiceDialog,
        setShowInvoiceDialog,
        invoiceType,
        setInvoiceType,
        initiateInvoiceDownload,
        handleBulkDownload,
        downloadToken,
        triggerDownload,
        stopProgress,
    };
};
