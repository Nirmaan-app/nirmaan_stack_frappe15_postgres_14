import { useCallback, useMemo, useState } from "react";
import { useFrappeFileUpload, useFrappePostCall } from "frappe-react-sdk";
import { CirclePlus, Download, FileText, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle,DialogTrigger } from "@/components/ui/dialog";
import { toast } from "@/components/ui/use-toast";
import SITEURL from "@/constants/siteURL";
import { CustomAttachment } from "@/components/helpers/CustomAttachment";
import { TailSpin } from "react-loader-spinner";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { format } from "date-fns";
import { ProjectPayments } from "@/types/NirmaanStack/ProjectPayments"; // Assuming this is the correct import

// The Frappe Print Format Name from the user's template
const PRINT_FORMAT_NAME = "SR Payment";
// The expected field name on the Project Payments DocType for the uploaded file
const VOUCHER_FIELD_NAME = "voucher_attachment"; 

// Augment ProjectPayments for the new field used in this component
interface ExtendedProjectPayments extends ProjectPayments {
    [VOUCHER_FIELD_NAME]?: string;
}

interface PaymentVoucherActionsProps {
    payment: ExtendedProjectPayments;
    srName: string; // The name of the parent Service Request (for filename)
    onVoucherUpdate: () => void; // Function to re-fetch payments data
}

// --- Upload Logic Component ---
const VoucherUploadAction = ({ payment, onVoucherUpdate, isLoading, srName }: Omit<PaymentVoucherActionsProps, 'payment'> & { payment: ExtendedProjectPayments, isLoading: boolean, srName: string }) => {
    const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);
    const [selectedFile, setSelectedFile] = useState<File | null>(null);

    const { upload: uploadFile, loading: isUploadingFile } = useFrappeFileUpload();
    const { call: setValue, loading: isSettingValue } = useFrappePostCall('frappe.client.set_value');

    const handleUpload = async () => {
        if (!selectedFile) return;

        try {
            const fileArgs = {
                doctype: "Project Payments",
                docname: payment.name,
                fieldname: VOUCHER_FIELD_NAME,
                isPrivate: true,
            };

            const uploadedFile = await uploadFile(selectedFile, fileArgs);

            await setValue({
                doctype: "Project Payments",
                name: payment.name,
                fieldname: VOUCHER_FIELD_NAME,
                value: uploadedFile.file_url,
            });

            toast({ title: "Success", description: "Voucher uploaded successfully!", variant: "success" });
            setIsUploadDialogOpen(false);
            onVoucherUpdate(); // Re-fetch data
            setSelectedFile(null);

        } catch (error) {
            console.error("Upload Error:", error);
            toast({ title: "Failed", description: "Failed to upload Voucher!", variant: "destructive" });
        }
    };

    const currentLoading = isUploadingFile || isSettingValue;
    
    return (
        <Dialog open={isUploadDialogOpen} onOpenChange={(open) => {
            setIsUploadDialogOpen(open);
            if (!open) setSelectedFile(null);
        }}>
            <DialogTrigger asChild>
                <Button 
                    variant="ghost" 
                    size="icon" 
                    disabled={isLoading}
                    className="h-6 w-6 p-0 text-gray-500 hover:text-black"
                    title="Upload Voucher"
                >
                    <Upload className="h-4 w-4" />
                </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>Upload Payment Voucher for {payment.name}</DialogTitle>
                </DialogHeader>
                <div className="flex flex-col space-y-4 pt-4">
                    <CustomAttachment
                        maxFileSize={20 * 1024 * 1024} // 20MB
                        selectedFile={selectedFile}
                        onFileSelect={setSelectedFile}
                        label="Select PDF to Upload"
                        accept=".pdf"
                        className="w-full"
                    />
                    <Button 
                        onClick={handleUpload} 
                        disabled={!selectedFile || currentLoading}
                        className="w-full flex items-center gap-2"
                    >
                        {currentLoading ? <TailSpin width={20} height={20} color="white" /> : <Upload className="w-4 h-4" />}
                        {currentLoading ? "Uploading..." : "Confirm Upload"}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}

// --- Main Action Component ---
export const PaymentVoucherActions = ({ payment, srName, onVoucherUpdate }: PaymentVoucherActionsProps) => {
    const [isDownloadDialogOpen, setIsDownloadDialogOpen] = useState(false);
    const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);

    const { call: setValue, loading: isSettingValue } = useFrappePostCall('frappe.client.set_value');
    
    const voucherAttachment = payment[VOUCHER_FIELD_NAME];
    const isLoading = isSettingValue; // Main loading state for the table cell actions (delete/upload)

    // --- PDF Generation / Download / Preview Logic ---

    // 3. Custom Filename: SR ID, Transaction ID, date, time, UTR
    const getFilename = useCallback(() => {
        if (!payment.name) return "payment_voucher.pdf";
        const creationDate = new Date(payment.creation);
        const paymentDatePart = payment.payment_date ? format(new Date(payment.payment_date), 'yyyyMMdd') : format(creationDate, 'yyyyMMdd');
        const timePart = format(creationDate, 'HHmmss');
        const utrPart = payment.utr ? `_${payment.utr.replace(/[^a-zA-Z0-9]/g, '')}` : ''; // Sanitize UTR
        
        // Final filename format: SRID_PAYMENTNAME_DATE_TIME_UTR.pdf
        return `${srName}_${payment.name}_${paymentDatePart}_${utrPart}.pdf`;
    }, [payment, srName]);

    // Frappe PDF download URL (forces a download with the correct filename)
    const downloadUrl = useMemo(() => {
        if (!payment.name) return "";
        const params = new URLSearchParams({
            doctype: "Project Payments",
            name: payment.name,
            format: PRINT_FORMAT_NAME,
            no_letterhead: "1",
            _lang: "en",
        });
        // We use download_pdf to ensure we can set a custom filename
        return `/api/method/frappe.utils.print_format.download_pdf?${params.toString()}`;
    }, [payment.name]);
    
    // Frappe Print URL (typically opens the document in a new tab for preview/printing)
    const printUrl = useMemo(() => {
        if (!payment.name) return "";
        const params = new URLSearchParams({
            doctype: "Project Payments",
            name: payment.name,
            format: PRINT_FORMAT_NAME,
            no_letterhead: "1",
            _lang: "en",
        });
        // Using get_print or printview allows direct browser rendering/preview
        return `/api/method/frappe.utils.print_format.download_pdf?${params.toString()}`;
    }, [payment.name]);

    const handleDownloadPdf = useCallback(() => {
        if (!downloadUrl) return;

        setIsGeneratingPdf(true);
        fetch(downloadUrl)
        .then(response => {
            if (!response.ok) throw new Error('PDF generation failed.');
            return response.blob();
        })
        .then(blob => {
            const filename = getFilename();
            const url = window.URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', filename);
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.URL.revokeObjectURL(url);
            toast({ title: "Success", description: `Voucher downloaded as ${filename}.`, variant: "success" });
        })
        .catch(error => {
            console.error("Download Error:", error);
            toast({ title: "Failed", description: "Failed to download the voucher PDF.", variant: "destructive" });
        })
        .finally(() => {
            setIsGeneratingPdf(false);
        });

    }, [downloadUrl, getFilename]);
    
    // Handler for Preview
    const handlePreviewPdf = useCallback(() => {
        if (!printUrl) return;
        window.open(printUrl, '_blank'); // Opens the PDF URL in a new tab
        setIsDownloadDialogOpen(false); // Close dialog after opening new tab
    }, [printUrl]);

    // --- Delete Logic ---
    const handleDelete = async () => {
        if (!payment.name || !voucherAttachment) return;
        
        try {
            // Setting the field to an empty string clears the link and often deletes the file attachment in Frappe
            await setValue({
                doctype: "Project Payments",
                name: payment.name,
                fieldname: VOUCHER_FIELD_NAME,
                value: "", // Clear the field value
            });
            
            toast({ title: "Success", description: "Voucher deleted successfully!", variant: "success" });
            onVoucherUpdate();
        } catch (error) {
            console.error("Delete Error:", error);
            toast({ title: "Failed", description: "Failed to delete Voucher!", variant: "destructive" });
        }
    };

    // --- Component Render ---

    if (voucherAttachment) {
        // VOUCHER ALREADY UPLOADED: Show View and Delete
        return (
            <div className="flex items-center gap-2 justify-center">
                <a href={`${SITEURL}${voucherAttachment}`} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:text-blue-700" title="View Voucher">
                    <FileText className="h-4 w-4" />
                </a>
                <AlertDialog>
                    <AlertDialogTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon"
                            disabled={isLoading}
                            className="h-6 w-6 p-0 text-destructive hover:bg-destructive/5 hover:text-destructive/90"
                            title="Delete Voucher"
                        >
                            {isLoading ? <TailSpin width={16} height={16} color="red" /> : <Trash2 className="h-4 w-4" />}
                        </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>Confirm Deletion</AlertDialogTitle>
                            <AlertDialogDescription>
                                This action will permanently remove the voucher attachment from this payment record.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={handleDelete} disabled={isLoading}>
                                {isLoading ? <TailSpin width={20} height={20} color="white" /> : "Delete"}
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            </div>
        );
    }

    // VOUCHER NOT UPLOADED: Show Generate Dialog and separate Upload action
    return (
        <div className="flex items-center justify-center gap-2">
            {/* 1. Generate/Download/Preview Dialog Trigger */}
            <Dialog open={isDownloadDialogOpen} onOpenChange={setIsDownloadDialogOpen}>
                <DialogTrigger asChild>
                    <Button 
                        variant="outline" 
                        size={"sm"} 
                        className="h-7 w-auto text-xs flex items-center gap-1 border border-primary px-2"
                        title="Generate Voucher"
                    >
                        <CirclePlus className="w-4 h-4" />
                        Gen
                    </Button>
                </DialogTrigger>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>Payment Voucher for {payment.name}</DialogTitle>
                    </DialogHeader>
                    <div className="flex flex-col space-y-4">
                        <div className="space-y-2">
                            <p className="text-sm font-semibold">Actions</p>
                            
                            {/* Preview Button */}
                            <Button 
                                onClick={handlePreviewPdf} 
                                className="w-full flex items-center gap-2"
                                variant="outline"
                            >
                                <FileText className="w-4 h-4" />
                                Preview PDF
                            </Button>
                            
                            {/* Download Button */}
                            <Button 
                                onClick={handleDownloadPdf} 
                                disabled={isGeneratingPdf}
                                className="w-full flex items-center gap-2"
                            >
                                {isGeneratingPdf ? <TailSpin width={20} height={20} color="white" /> : <Download className="w-4 h-4" />}
                                {isGeneratingPdf ? "Generating..." : "Download PDF (Voucher)"}
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
            
            {/* 2. Separate Upload Action */}
            <VoucherUploadAction 
                payment={payment} 
                srName={srName}
                onVoucherUpdate={onVoucherUpdate} 
                isLoading={isLoading} 
            />
        </div>
    );
};



// import { useCallback, useMemo, useState } from "react";
// import { useFrappeFileUpload, useFrappePostCall } from "frappe-react-sdk";
// import { CirclePlus, Download, FileText, Trash2, Upload } from "lucide-react";
// import { Button } from "@/components/ui/button";
// import { Dialog, DialogContent, DialogHeader, DialogTitle,DialogTrigger } from "@/components/ui/dialog";
// import { toast } from "@/components/ui/use-toast";
// import SITEURL from "@/constants/siteURL";
// import { CustomAttachment } from "@/components/helpers/CustomAttachment";
// import { TailSpin } from "react-loader-spinner";
// import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
// import { format } from "date-fns";
// import { ProjectPayments } from "@/types/NirmaanStack/ProjectPayments"; // Assuming this is the correct import

// // The Frappe Print Format Name from the user's template
// const PRINT_FORMAT_NAME = "SR Payment"; // Use the name from your Frappe system
// // The expected field name on the Project Payments DocType for the uploaded file
// const VOUCHER_FIELD_NAME = "voucher_attachment"; 

// // Augment ProjectPayments for the new field used in this component
// interface ExtendedProjectPayments extends ProjectPayments {
//     [VOUCHER_FIELD_NAME]?: string;
// }

// interface PaymentVoucherActionsProps {
//     payment: ExtendedProjectPayments;
//     srName: string; // The name of the parent Service Request (for filename)
//     onVoucherUpdate: () => void; // Function to re-fetch payments data
// }

// type PdfAction = "preview" | "download";

// // --- Upload Logic Component (Renders the Upload icon button and dialog) ---
// const VoucherUploadAction = ({ payment, onVoucherUpdate, isLoading }: Omit<PaymentVoucherActionsProps, 'payment' | 'srName'> & { payment: ExtendedProjectPayments, isLoading: boolean }) => {
//     const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);
//     const [selectedFile, setSelectedFile] = useState<File | null>(null);

//     const { upload: uploadFile, loading: isUploadingFile } = useFrappeFileUpload();
//     const { call: setValue, loading: isSettingValue } = useFrappePostCall('frappe.client.set_value');

//     const handleUpload = async () => {
//         if (!selectedFile) return;

//         try {
//             const fileArgs = {
//                 doctype: "Project Payments",
//                 docname: payment.name,
//                 fieldname: VOUCHER_FIELD_NAME,
//                 isPrivate: true,
//             };

//             const uploadedFile = await uploadFile(selectedFile, fileArgs);

//             await setValue({
//                 doctype: "Project Payments",
//                 name: payment.name,
//                 fieldname: VOUCHER_FIELD_NAME,
//                 value: uploadedFile.file_url,
//             });

//             toast({ title: "Success", description: "Voucher uploaded successfully!", variant: "success" });
//             setIsUploadDialogOpen(false);
//             onVoucherUpdate(); // Re-fetch data
//             setSelectedFile(null);

//         } catch (error) {
//             console.error("Upload Error:", error);
//             toast({ title: "Failed", description: "Failed to upload Voucher!", variant: "destructive" });
//         }
//     };

//     const currentLoading = isUploadingFile || isSettingValue;
    
//     return (
//         <Dialog open={isUploadDialogOpen} onOpenChange={(open) => {
//             setIsUploadDialogOpen(open);
//             if (!open) setSelectedFile(null);
//         }}>
//             <DialogTrigger asChild>
//                 <Button 
//                     variant="ghost" 
//                     size="icon" 
//                     disabled={isLoading}
//                     className="h-6 w-6 p-0 text-gray-500 hover:text-black"
//                     title="Upload Voucher"
//                 >
//                     <Upload className="h-4 w-4" />
//                 </Button>
//             </DialogTrigger>
//             <DialogContent className="max-w-md">
//                 <DialogHeader>
//                     <DialogTitle>Upload Payment Voucher for {payment.name}</DialogTitle>
//                 </DialogHeader>
//                 <div className="flex flex-col space-y-4 pt-4">
//                     <CustomAttachment
//                         maxFileSize={20 * 1024 * 1024} // 20MB
//                         selectedFile={selectedFile}
//                         onFileSelect={setSelectedFile}
//                         label="Select PDF to Upload"
//                         accept=".pdf"
//                         className="w-full"
//                     />
//                     <Button 
//                         onClick={handleUpload} 
//                         disabled={!selectedFile || currentLoading}
//                         className="w-full flex items-center gap-2"
//                     >
//                         {currentLoading ? <TailSpin width={20} height={20} color="white" /> : <Upload className="w-4 h-4" />}
//                         {currentLoading ? "Uploading..." : "Confirm Upload"}
//                     </Button>
//                 </div>
//             </DialogContent>
//         </Dialog>
//     );
// }

// // --- Main Action Component ---
// export const PaymentVoucherActions = ({ payment, srName, onVoucherUpdate }: PaymentVoucherActionsProps) => {
//     const [isDownloadDialogOpen, setIsDownloadDialogOpen] = useState(false);
//     const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);

//     const { call: setValue, loading: isSettingValue } = useFrappePostCall('frappe.client.set_value');
    
//     const voucherAttachment = payment[VOUCHER_FIELD_NAME];
//     const isLoading = isSettingValue; 

//     // 3. Custom Filename: SR ID, Transaction ID, date, time, UTR
//     const getFilename = useCallback(() => {
//         if (!payment.name) return "payment_voucher.pdf";
//         const creationDate = new Date(payment.creation);
//         const paymentDatePart = payment.payment_date ? format(new Date(payment.payment_date), 'yyyyMMdd') : format(creationDate, 'yyyyMMdd');
//         const utrPart = payment.utr ? `_${payment.utr.replace(/[^a-zA-Z0-9]/g, '')}` : ''; 
        
//         // Final filename format: SRID_PAYMENTNAME_DATE_TIME_UTR.pdf
//         return `${srName}_${payment.name}_${paymentDatePart}_${utrPart}.pdf`;
//     }, [payment, srName]);

//     // Consolidate URL construction and PDF generation into one function
//     const generateSRPaymentPDF = useCallback(async (action: PdfAction) => {
//         if (!payment.name) {
//             toast({ title: "Error", description: "Payment document name is missing.", variant: "destructive" });
//             return;
//         }

//         setIsGeneratingPdf(true);

//         try {
//             const params = new URLSearchParams({
//                 doctype: "Project Payments",
//                 name: payment.name,
//                 format: PRINT_FORMAT_NAME,
//                 no_letterhead: "1",
//                 _lang: "en",
//             });
            
//             if (action === "preview") {
//                 // ACTION 1: Preview (Direct Frappe API call to render content in new tab)
//                 const printUrl = `${SITEURL}/api/method/frappe.utils.print_format.download_pdf?${params.toString()}`;
//                 window.open(printUrl, '_blank');
//                 setIsDownloadDialogOpen(false); // Close dialog on successful action
//             } else {
//                 // ACTION 2: Download (Use download_pdf endpoint and fetch to handle custom filename)
//                fetch(`${SITEURL}/api/method/frappe.utils.print_format.download_pdf?${params.toString()}`)
//         .then(response => {
//             if (!response.ok) throw new Error('PDF generation failed.');
//             return response.blob();
//         })
//         .then(blob => {
//             const filename = getFilename();
//             const url = window.URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
//             const link = document.createElement('a');
//             link.href = url;
//             link.setAttribute('download', filename);
//             document.body.appendChild(link);
//             link.click();
//             link.remove();
//             window.URL.revokeObjectURL(url);
//             toast({ title: "Success", description: `Voucher downloaded as ${filename}.`, variant: "success" });
//         })
//         .catch(error => {
//             console.error("Download Error:", error);
//             toast({ title: "Failed", description: "Failed to download the voucher PDF.", variant: "destructive" });
//         })
//         .finally(() => {
//             setIsGeneratingPdf(false);
//         });
//             }

//         } catch (error) {
//             console.error(`Error during PDF ${action}:`, error);
//             toast({ 
//                 title: "Failed!", 
//                 description: `Failed to ${action} the voucher PDF. Check console for details.`, 
//                 variant: "destructive" 
//             });
//         } finally {
//             setIsGeneratingPdf(false);
//         }
//     }, [payment.name, getFilename]);

//     // --- Delete Logic (UNTOUCHED) ---
//     const handleDelete = async () => {
//         if (!payment.name || !voucherAttachment) return;
        
//         try {
//             await setValue({
//                 doctype: "Project Payments",
//                 name: payment.name,
//                 fieldname: VOUCHER_FIELD_NAME,
//                 value: "", // Clear the field value
//             });
            
//             toast({ title: "Success", description: "Voucher deleted successfully!", variant: "success" });
//             onVoucherUpdate();
//         } catch (error) {
//             console.error("Delete Error:", error);
//             toast({ title: "Failed", description: "Failed to delete Voucher!", variant: "destructive" });
//         }
//     };

//     // --- Component Render ---

//     if (voucherAttachment) {
//         // VOUCHER ALREADY UPLOADED: Show View and Delete
//         return (
//             <div className="flex items-center gap-2 justify-center">
//                 <a href={`${SITEURL}${voucherAttachment}`} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:text-blue-700" title="View Voucher">
//                     <FileText className="h-4 w-4" />
//                 </a>
//                 <AlertDialog>
//                     <AlertDialogTrigger asChild>
//                         <Button
//                             variant="ghost"
//                             size="icon"
//                             disabled={isLoading}
//                             className="h-6 w-6 p-0 text-destructive hover:bg-destructive/5 hover:text-destructive/90"
//                             title="Delete Voucher"
//                         >
//                             {isLoading ? <TailSpin width={16} height={16} color="red" /> : <Trash2 className="h-4 w-4" />}
//                         </Button>
//                     </AlertDialogTrigger>
//                     <AlertDialogContent>
//                         <AlertDialogHeader>
//                             <AlertDialogTitle>Confirm Deletion</AlertDialogTitle>
//                             <AlertDialogDescription>
//                                 This action will permanently remove the voucher attachment from this payment record.
//                             </AlertDialogDescription>
//                         </AlertDialogHeader>
//                         <AlertDialogFooter>
//                             <AlertDialogCancel>Cancel</AlertDialogCancel>
//                             <AlertDialogAction onClick={handleDelete} disabled={isLoading}>
//                                 {isLoading ? <TailSpin width={20} height={20} color="white" /> : "Delete"}
//                             </AlertDialogAction>
//                         </AlertDialogFooter>
//                     </AlertDialogContent>
//                 </AlertDialog>
//             </div>
//         );
//     }

//     // VOUCHER NOT UPLOADED: Show Generate Dialog and separate Upload action
//     return (
//         <div className="flex items-center justify-center gap-2">
//             {/* 1. Generate/Download/Preview Dialog Trigger */}
//             <Dialog open={isDownloadDialogOpen} onOpenChange={setIsDownloadDialogOpen}>
//                 <DialogTrigger asChild>
//                     <Button 
//                         variant="outline" 
//                         size={"sm"} 
//                         className="h-7 w-auto text-xs flex items-center gap-1 border border-primary px-2"
//                         title="Generate Voucher"
//                     >
//                         <CirclePlus className="w-4 h-4" />
//                         Gen
//                     </Button>
//                 </DialogTrigger>
//                 <DialogContent className="max-w-md">
//                     <DialogHeader>
//                         <DialogTitle>Payment Voucher for {payment.name}</DialogTitle>
//                     </DialogHeader>
//                     <div className="flex flex-col space-y-4">
//                         <div className="space-y-2">
//                             <p className="text-sm font-semibold">Actions</p>
                            
//                             {/* Preview Button */}
//                             <Button 
//                                 onClick={() => generateSRPaymentPDF("preview")} 
//                                 disabled={isGeneratingPdf}
//                                 className="w-full flex items-center gap-2"
//                                 variant="outline"
//                             >
//                                 {isGeneratingPdf ? <TailSpin width={20} height={20} color="gray" /> : <FileText className="w-4 h-4" />}
//                                 {isGeneratingPdf ? "Generating..." : "Preview PDF"}
//                             </Button>
                            
//                             {/* Download Button */}
//                             <Button 
//                                 onClick={() => generateSRPaymentPDF("download")} 
//                                 disabled={isGeneratingPdf}
//                                 className="w-full flex items-center gap-2"
//                             >
//                                 {isGeneratingPdf ? <TailSpin width={20} height={20} color="white" /> : <Download className="w-4 h-4" />}
//                                 {isGeneratingPdf ? "Generating..." : "Download PDF (Voucher)"}
//                             </Button>
//                         </div>
//                     </div>
//                 </DialogContent>
//             </Dialog>
            
//             {/* 2. Separate Upload Action */}
//             <VoucherUploadAction 
//                 payment={payment} 
//                 onVoucherUpdate={onVoucherUpdate} 
//                 isLoading={isLoading} 
//             />
//         </div>
//     );
// };