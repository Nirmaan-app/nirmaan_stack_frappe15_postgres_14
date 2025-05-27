import { useState, useCallback } from 'react';
import { useFrappeFileUpload, useFrappePostCall } from 'frappe-react-sdk';
import { toast } from '@/components/ui/use-toast';

export const usePaymentScreenshotHandler = (
    onUploadSuccess?: () => void // e.g., to mutate payments list
) => {
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [isUploading, setIsUploading] = useState(false); // Manual loading state

    const { upload, loading: fileUploadLoading } = useFrappeFileUpload();
    const { call: setFileValue, loading: setValueLoading } = useFrappePostCall('frappe.client.set_value');

    const handleFileSelect = useCallback((file: File | null) => {
        setSelectedFile(file);
    }, []);

    const handleSubmitScreenshot = async (paymentDocName: string) => {
        if (!selectedFile || !paymentDocName) {
            toast({ title: "Error", description: "No file selected or payment ID missing.", variant: "destructive" });
            return;
        }
        setIsUploading(true);
        try {
            const fileArgs = {
                doctype: "Project Payments",
                docname: paymentDocName,
                fieldname: "payment_attachment", // Ensure this field exists on Project Payments
                isPrivate: true, // Typically true for payment proofs
            };
            const uploadedFile = await upload(selectedFile, fileArgs); // Third arg is progress if needed

            await setFileValue({
                doctype: "Project Payments",
                name: paymentDocName,
                fieldname: "payment_attachment",
                value: uploadedFile.file_url,
            });

            toast({ title: "Success", description: "Screenshot uploaded and linked.", variant: "success" });
            setSelectedFile(null); // Reset after upload
            onUploadSuccess?.();
        } catch (error: any) {
            toast({ title: "Upload Failed", description: error.message || "Could not upload screenshot.", variant: "destructive" });
        } finally {
            setIsUploading(false);
        }
    };

    return {
        selectedFile,
        handleFileSelect,
        handleSubmitScreenshot,
        isUploading: isUploading || fileUploadLoading || setValueLoading,
    };
};