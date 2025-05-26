import React from 'react';
import {
    AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogHeader,
    AlertDialogTitle, AlertDialogFooter, AlertDialogDescription
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { CustomAttachment } from "@/components/helpers/CustomAttachment"; // Your attachment component
import { usePaymentScreenshotHandler } from '../hooks/usePaymentScreenshotHandler';
import { ProjectPayments } from '@/types/NirmaanStack/ProjectPayments';
import { TailSpin } from 'react-loader-spinner';

interface PaymentScreenshotDialogProps {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    paymentDoc: ProjectPayments;
    onUploadSuccess: () => void;
}

export const PaymentScreenshotDialog: React.FC<PaymentScreenshotDialogProps> = ({
    isOpen,
    onOpenChange,
    paymentDoc,
    onUploadSuccess,
}) => {
    const {
        selectedFile,
        handleFileSelect,
        handleSubmitScreenshot,
        isUploading,
    } = usePaymentScreenshotHandler(onUploadSuccess);

    const handleConfirm = () => {
        handleSubmitScreenshot(paymentDoc.name);
    };

    return (
        <AlertDialog open={isOpen} onOpenChange={onOpenChange}>
            <AlertDialogContent className="sm:max-w-md">
                <AlertDialogHeader>
                    <AlertDialogTitle className="text-center">Upload Payment Screenshot</AlertDialogTitle>
                    <AlertDialogDescription className="text-center text-sm">
                        For Payment ID: {paymentDoc.name} (UTR: {paymentDoc.utr || 'N/A'})
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <div className="py-4">
                    <CustomAttachment
                        maxFileSize={20 * 1024 * 1024} // 20MB
                        selectedFile={selectedFile}
                        onFileSelect={handleFileSelect}
                        label="Select Screenshot (Image/PDF)"
                    />
                </div>
                <AlertDialogFooter>
                    <AlertDialogCancel disabled={isUploading}>Cancel</AlertDialogCancel>
                    <Button onClick={handleConfirm} disabled={isUploading || !selectedFile}>
                        {isUploading ? <TailSpin color="white" height={20} width={20} /> : "Upload & Save"}
                    </Button>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
};