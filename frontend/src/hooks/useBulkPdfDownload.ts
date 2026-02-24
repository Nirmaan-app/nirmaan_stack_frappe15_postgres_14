import { useState, useContext } from "react";
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
                    const effectiveWithRate = isProjectManager ? false : !!options?.withRate;
                    const rateParam = effectiveWithRate ? 1 : 0;
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
            const contentType = response.headers.get("content-type");

            if (contentType && contentType.includes("application/json")) {
                const errorData = await response.json();
                console.log("Error Data:", errorData); // DEBUG
                
                // If the error message is generic, try to be more specific based on response
                let errorMessage = errorData.message || errorData._server_messages || `Failed to generate ${label} PDF`;
                
                // Parse server messages if needed (Frappe sometimes returns JSON string in _server_messages)
                if (errorData._server_messages) {
                    try {
                        const messages = JSON.parse(errorData._server_messages);
                        const messageObj = JSON.parse(messages[0]);
                        errorMessage = messageObj.message || errorMessage;
                    } catch (e) {
                        // Keep original errorMessage
                    }
                }

                // If message is still generic but we have an exception trace, try to extract relevant info
                if (errorMessage.includes("Failed to generate") && errorData.exc) {
                     try {
                        const exc = JSON.parse(errorData.exc);
                        const excStr = exc[0] || "";
                         if (excStr.includes("image") || excStr.includes("Image")) {
                             errorMessage += ": One or more documents contain invalid images.";
                         } else if (excStr.includes("file") || excStr.includes("File")) {
                             errorMessage += ": Missing or corrupted file attachments.";
                         } else if (excStr.includes("No data")) {
                             errorMessage = `No ${label} data found to export.`;
                         }
                     } catch (e) {
                         // Ignore exc parsing error
                     }
                }

                 // Append general guidance if still vague (check includes instead of strict equality)
                 if (errorMessage.includes("Failed to generate") && !errorMessage.includes(":")) {
                     errorMessage += ". Possible causes: Invalid images, missing files, or no data.";
                 }

                console.log("Final Error Message:", errorMessage); // DEBUG
                throw new Error(errorMessage);
            }

            if (!response.ok) {
                console.log("Response not OK and not JSON. Status:", response.status); // DEBUG
                // If not JSON but error status
                if (response.status === 404) {
                    throw new Error(`No ${label} data found for this project.`);
                }
                if (response.status === 500) {
                     throw new Error(`Server error. A document likely has a corrupted image or invalid data.`);
                }
                throw new Error(`Failed to generate ${label} PDF (Status: ${response.status})`);
            }

            const blob = await response.blob();
            if (blob.size === 0) {
                 throw new Error(`Generated PDF is empty. No ${label} data found.`);
            }

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
            
            // Highlight if it's a specific document error
            const isSpecificDocError = error.message.toLowerCase().includes("image") || 
                                       error.message.toLowerCase().includes("file") || 
                                       error.message.toLowerCase().includes("corrupted") || 
                                       error.message.toLowerCase().includes("data") ||
                                       error.message.toLowerCase().includes("failed to generate"); // Treat as specific if hinting worked
            
                                       console.log(isSpecificDocError)
            toast({
                title: isSpecificDocError ? "Download Failed: Document Issue" : "Download Failed",
                description: error.message,
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
