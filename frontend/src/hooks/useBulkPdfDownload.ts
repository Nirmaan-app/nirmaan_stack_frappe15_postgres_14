import { useState, useContext } from "react";
import { useToast } from "@/components/ui/use-toast";
import { FrappeContext, FrappeConfig } from "frappe-react-sdk";

export const useBulkPdfDownload = (projectId: string) => {
    const { toast } = useToast();
    const { socket } = useContext(FrappeContext) as FrappeConfig;
    const [loading, setLoading] = useState(false);
    const [showProgress, setShowProgress] = useState(false);
    const [progress, setProgress] = useState(0);
    const [progressMessage, setProgressMessage] = useState("");
    const [showRateDialog, setShowRateDialog] = useState(false);
    const [withRate, setWithRate] = useState(true);

    const initiatePODownload = () => {
        setShowRateDialog(true);
        setWithRate(true);
    };

    const handleDownload = async (type: "PO" | "WO", label: string, rateOption: boolean = true) => {
        try {
            setShowRateDialog(false);
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
            if (type === "PO") {
                const rateParam = rateOption ? 1 : 0;
                endpoint = `/api/method/nirmaan_stack.api.pdf_helper.bulk_download.download_all_pos?project=${projectId}&with_rate=${rateParam}`;
            } else {
                endpoint = `/api/method/nirmaan_stack.api.pdf_helper.bulk_download.download_all_wos?project=${projectId}`;
            }

            const response = await fetch(endpoint);

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || "Failed to generate PDF");
            }

            const blob = await response.blob();
            const downloadUrl = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = downloadUrl;
            a.download = `${projectId}_All_${label}.pdf`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(downloadUrl);

            toast({
                title: "Success",
                description: "PDF downloaded successfully.",
                variant: "success",
            });

        } catch (error: any) {
            console.error("Bulk download error:", error);
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
        handleDownload
    };
};
