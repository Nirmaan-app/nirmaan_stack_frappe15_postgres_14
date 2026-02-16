import { useState, useContext } from "react";
import { useToast } from "@/components/ui/use-toast";
import { FrappeContext, FrappeConfig } from "frappe-react-sdk";

export type DownloadType = "PO" | "WO" | "Invoice" | "DC" | "MIR" | "DN";

export const useBulkPdfDownload = (projectId: string, projectName?: string) => {
    const { toast } = useToast();
    const { socket } = useContext(FrappeContext) as FrappeConfig;
    const [loading, setLoading] = useState(false);
    const [showProgress, setShowProgress] = useState(false);
    const [progress, setProgress] = useState(0);
    const [progressMessage, setProgressMessage] = useState("");
    
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

    const handleBulkDownload = async (type: DownloadType, label: string, options?: any) => {
        try {
            if (type === "PO") setShowRateDialog(false);
            if (type === "Invoice") setShowInvoiceDialog(false);

            setLoading(true);
            setShowProgress(true);
            setProgress(0);
            setProgressMessage(`Starting ${label} download...`);

            if (socket) {
                socket.on("bulk_download_progress", (data: any) => {
                    if (data.progress) setProgress(data.progress);
                    if (data.message) setProgressMessage(data.message);
                });
            }

            let endpoint = "";
            let fileName = "";

            switch (type) {
                case "PO":
                    const rateParam = options?.withRate ? 1 : 0;
                    endpoint = `/api/method/nirmaan_stack.api.pdf_helper.bulk_download.download_all_pos?project=${projectId}&with_rate=${rateParam}`;
                    fileName = `${projectName || projectId}_All_POs.pdf`;
                    break;
                case "WO":
                    endpoint = `/api/method/nirmaan_stack.api.pdf_helper.bulk_download.download_all_wos?project=${projectId}`;
                    fileName = `${projectName || projectId}_All_WOs.pdf`;
                    break;
                case "Invoice":
                    const invType = options?.invoiceType || invoiceType;
                    endpoint = `/api/method/nirmaan_stack.api.pdf_helper.bulk_download.download_project_attachments?project=${projectId}&doc_type=${invType}`;
                    fileName = `${projectName || projectId}_${invType.replace(/ /g, "_")}.pdf`;
                    break;
                case "DC":
                    endpoint = `/api/method/nirmaan_stack.api.pdf_helper.bulk_download.download_project_attachments?project=${projectId}&doc_type=DC`;
                    fileName = `${projectName || projectId}_Delivery_Challans.pdf`;
                    break;
                case "MIR":
                    endpoint = `/api/method/nirmaan_stack.api.pdf_helper.bulk_download.download_project_attachments?project=${projectId}&doc_type=MIR`;
                    fileName = `${projectName || projectId}_Material_Inspection_Reports.pdf`;
                    break;
                case "DN":
                    endpoint = `/api/method/nirmaan_stack.api.pdf_helper.bulk_download.download_all_dns?project=${projectId}`;
                    fileName = `${projectName || projectId}_All_DNs.pdf`;
                    break;
            }

            const response = await fetch(endpoint);

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || `Failed to generate ${label} PDF`);
            }

            const blob = await response.blob();
            const downloadUrl = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = downloadUrl;
            a.download = fileName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(downloadUrl);

            toast({
                title: "Success",
                description: `${label} downloaded successfully.`,
                variant: "success",
            });

        } catch (error: any) {
            console.error(`Bulk ${label} download error:`, error);
            toast({
                title: "Error",
                description: error.message || "Something went wrong.",
                variant: "destructive",
            });
        } finally {
            setLoading(false);
            setShowProgress(false);
            if (socket) {
                socket.off("bulk_download_progress");
            }
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
        handleBulkDownload
    };
};
