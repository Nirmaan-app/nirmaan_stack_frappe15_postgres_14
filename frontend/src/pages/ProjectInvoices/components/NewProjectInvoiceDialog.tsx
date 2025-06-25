// src/pages/ProjectInvoices/components/NewProjectInvoiceDialog.tsx
// (Previously ProjectInvoiceDialog.tsx - now focused on creation)

import React, { useCallback, useState, useEffect, useContext } from "react"; // Removed useMemo not used
import { useFrappeCreateDoc, useFrappeFileUpload } from "frappe-react-sdk";
import { TailSpin } from "react-loader-spinner";
import { KeyedMutator } from 'swr';
import { formatDate as formatDateFns } from "date-fns";

import { CustomAttachment, AcceptedFileType } from "@/components/helpers/CustomAttachment";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogFooter } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/use-toast";
import { ProjectInvoice } from "@/types/NirmaanStack/ProjectInvoice";
import { parseNumber } from "@/utils/parseNumber";
import { useDialogStore } from "@/zustand/useDialogStore";
import ProjectSelect from "@/components/custom-select/project-select";
// Removed UserContext if selectedProject from context is not the primary way to set project for new invoices.
// If it is, you can re-add it. This example assumes ProjectId prop or ProjectSelect for new.

const DOCTYPE = "Project Invoices"; // Moved to top for clarity
const ATTACHMENT_ACCEPTED_TYPES: AcceptedFileType[] = ["image/*", "application/pdf"];

interface NewProjectInvoiceDialogProps {
    listMutate: KeyedMutator<any>;
    ProjectId?: string; // For pre-selecting project if dialog opened from a specific project context
    onClose?: () => void; // Optional: if parent needs to do something on close
}

interface InvoiceFormState {
    invoice_no: string;
    amount: string;
    date: string;
    project: string;
}

export function NewProjectInvoiceDialog({ listMutate, ProjectId, onClose }: NewProjectInvoiceDialogProps) {
    const { newProjectInvoiceDialog, toggleNewProjectInvoiceDialog, setNewProjectInvoiceDialog } = useDialogStore();

    const getInitialState = useCallback((): InvoiceFormState => ({
        invoice_no: "",
        amount: "",
        date: "",
        project: ProjectId || "" // Pre-fill if ProjectId is provided
    }), [ProjectId]);

    const [invoiceData, setInvoiceData] = useState<InvoiceFormState>(getInitialState());
    const [selectedAttachment, setSelectedAttachment] = useState<File | null>(null);
    const [formErrors, setFormErrors] = useState<Partial<InvoiceFormState>>({});


    const { createDoc, loading: createDocLoading } = useFrappeCreateDoc();
    const { upload, loading: uploadLoading } = useFrappeFileUpload();

    useEffect(() => {
        if (newProjectInvoiceDialog) { // Only reset when this specific dialog is intended to be open
            setInvoiceData(getInitialState());
            setSelectedAttachment(null);
            setFormErrors({});
        }
    }, [newProjectInvoiceDialog, getInitialState]);

    const handleDialogClose = () => {
        setNewProjectInvoiceDialog(false); // Use explicit setter
        onClose?.();
    };

    const handleAttachmentError = useCallback(({ message }: { type: "size" | "type", message: string }) => {
        toast({ title: "Attachment Error", description: message, variant: "destructive", });
    }, [toast]);

    const validateForm = (): boolean => {
        const errors: Partial<InvoiceFormState> = {};
        if (!invoiceData.project) errors.project = "Project is required.";
        if (!invoiceData.invoice_no.trim()) errors.invoice_no = "Invoice number is required.";
        if (!invoiceData.amount || parseNumber(invoiceData.amount) <= 0) errors.amount = "A valid amount is required.";
        if (!invoiceData.date) errors.date = "Invoice date is required.";
        if (!selectedAttachment) errors.project = "Invoice attachment is required."; // Generic error, or attach to a specific field for attachment

        setFormErrors(errors);
        return Object.keys(errors).length === 0;
    }

    const handleSubmitInvoice = useCallback(async (event?: React.FormEvent) => {
        if (event) event.preventDefault();
        if (!validateForm()) {
            toast({ title: "Validation Error", description: "Please fill all required fields and attach the invoice.", variant: "destructive" });
            return;
        }

        try {
            let fileUrl: string | undefined = undefined;
            if (selectedAttachment) {
                const tempDocName = `temp-proj-inv-${Date.now()}`;
                const fileArgs = { doctype: DOCTYPE, docname: tempDocName, fieldname: "attachment", isPrivate: true };
                const uploadedFile = await upload(selectedAttachment, fileArgs);
                fileUrl = uploadedFile.file_url;
            }

            if (!fileUrl) { // Should have an attachment for new invoices
                toast({ title: "Attachment Error", description: "File upload failed or no attachment selected.", variant: "destructive" });
                return;
            }

            const newInvoicePayload: Omit<ProjectInvoice, 'name' | 'owner' | 'creation' | 'modified'> = {
                invoice_no: invoiceData.invoice_no.trim(),
                amount: parseNumber(invoiceData.amount),
                invoice_date: invoiceData.date,
                attachment: fileUrl,
                project: invoiceData.project,
            };

            await createDoc(DOCTYPE, newInvoicePayload);
            toast({ title: "Success!", description: `Invoice ${invoiceData.invoice_no} created.`, variant: "success" });
            await listMutate();
            handleDialogClose();
        } catch (error) {
            console.error("Error creating Invoice:", error);
            toast({
                title: "Creation Failed",
                description: error instanceof Error ? error.message : "An unexpected error occurred.",
                variant: "destructive"
            });
        }
    }, [
        invoiceData, selectedAttachment, upload, createDoc, listMutate, handleDialogClose, validateForm
    ]);

    const isLoading = uploadLoading || createDocLoading;

    return (
        <AlertDialog open={newProjectInvoiceDialog} onOpenChange={(isOpen) => { if (!isOpen) handleDialogClose(); else setNewProjectInvoiceDialog(true); }}>
            <AlertDialogContent className="sm:max-w-lg">
                <AlertDialogHeader>
                    <AlertDialogTitle className="text-center text-xl">Add New Invoice</AlertDialogTitle>
                </AlertDialogHeader>

                <form onSubmit={handleSubmitInvoice} className="space-y-6 pt-4">
                    <div className="space-y-4">
                        {/* Project Select: Show if ProjectId is not passed (i.e., creating from a general list view) */}
                        {!ProjectId && (
                            <div className="grid grid-cols-1 items-start gap-2 sm:grid-cols-3 sm:items-center sm:gap-4">
                                <Label htmlFor="project_invoice_project_new" className="sm:text-left">
                                    Project<sup className="text-red-500 ml-1">*</sup>:
                                </Label>
                                <div className="sm:col-span-2">
                                    <ProjectSelect
                                        value={invoiceData.project ? { value: invoiceData.project, label: invoiceData.project } : null} // ProjectSelect might need better label handling
                                        onChange={(selected) => setInvoiceData(prev => ({ ...prev, project: selected?.value || "" }))}
                                        disabled={isLoading}
                                        universal // Assuming this prop exists and fetches all projects
                                    />
                                    {formErrors.project && <p className="text-xs text-destructive mt-1">{formErrors.project}</p>}
                                </div>
                            </div>
                        )}
                        {/* If ProjectId is passed, you might want to display it as a disabled field or just use it internally */}
                        {ProjectId && (
                            <div className="grid grid-cols-1 items-start gap-2 sm:grid-cols-3 sm:items-center sm:gap-4">
                                <Label htmlFor="project_invoice_project_new_fixed" className="sm:text-left">Project:</Label>
                                <Input id="project_invoice_project_new_fixed" value={invoiceData.project} className="sm:col-span-2 bg-muted/50" disabled />
                            </div>
                        )}


                        <div className="grid grid-cols-1 items-start gap-2 sm:grid-cols-3 sm:items-center sm:gap-4">
                            <Label htmlFor="invoice_no_new_proj_inv" className="sm:text-left">Invoice No<sup className="text-red-500 ml-1">*</sup>:</Label>
                            <Input id="invoice_no_new_proj_inv" value={invoiceData.invoice_no} onChange={(e) => setInvoiceData(prev => ({ ...prev, invoice_no: e.target.value }))} className="sm:col-span-2" disabled={isLoading} />
                            {formErrors.invoice_no && <p className="col-span-1 sm:col-span-3 sm:col-start-2 text-xs text-destructive mt-1">{formErrors.invoice_no}</p>}
                        </div>
                        <div className="grid grid-cols-1 items-start gap-2 sm:grid-cols-3 sm:items-center sm:gap-4">
                            <Label htmlFor="invoice_date_new_proj_inv" className="sm:text-left">Invoice Date<sup className="text-red-500 ml-1">*</sup>:</Label>
                            <Input id="invoice_date_new_proj_inv" type="date" value={invoiceData.date} onChange={(e) => setInvoiceData(prev => ({ ...prev, date: e.target.value }))} max={formatDateFns(new Date(), "yyyy-MM-dd")} className="sm:col-span-2" disabled={isLoading} />
                            {formErrors.date && <p className="col-span-1 sm:col-span-3 sm:col-start-2 text-xs text-destructive mt-1">{formErrors.date}</p>}
                        </div>
                        <div className="grid grid-cols-1 items-start gap-2 sm:grid-cols-3 sm:items-center sm:gap-4">
                            <Label htmlFor="invoice_amount_new_proj_inv" className="sm:text-left">Amount (Incl. GST)<sup className="text-red-500 ml-1">*</sup>:</Label>
                            <Input id="invoice_amount_new_proj_inv" type="text" inputMode="decimal" value={invoiceData.amount}
                                onChange={(e) => { const val = e.target.value; if (/^\d*\.?\d*$/.test(val)) setInvoiceData(prev => ({ ...prev, amount: val })); }}
                                className="sm:col-span-2" disabled={isLoading} />
                            {formErrors.amount && <p className="col-span-1 sm:col-span-3 sm:col-start-2 text-xs text-destructive mt-1">{formErrors.amount}</p>}
                        </div>
                    </div>

                    <div className="grid grid-cols-1 items-start gap-2 sm:grid-cols-3 sm:items-center sm:gap-4">
                        <Label className="sm:text-left pt-1">Attachment<sup className="text-red-500 ml-1">*</sup>:</Label>
                        <div className="sm:col-span-2">
                            <CustomAttachment
                                label="Attach Invoice File"
                                selectedFile={selectedAttachment}
                                onFileSelect={setSelectedAttachment}
                                onError={handleAttachmentError}
                                maxFileSize={5 * 1024 * 1024}
                                acceptedTypes={ATTACHMENT_ACCEPTED_TYPES}
                                isRequired={true}
                                disabled={isLoading}
                            />
                            {formErrors.project && !selectedAttachment && <p className="text-xs text-destructive mt-1">{formErrors.project}</p>}
                        </div>
                    </div>

                    <AlertDialogFooter className="pt-4">
                        {isLoading ? (
                            <div className='flex justify-center items-center w-full h-10'><TailSpin color="#4f46e5" width={30} height={30} /></div>
                        ) : (
                            <>
                                <AlertDialogCancel asChild><Button variant="outline" type="button" onClick={handleDialogClose}>Cancel</Button></AlertDialogCancel>
                                <Button type="submit" disabled={isLoading || !invoiceData.date || !invoiceData.invoice_no || !invoiceData.amount || !selectedAttachment || !invoiceData.project}>
                                    Confirm
                                </Button>
                            </>
                        )}
                    </AlertDialogFooter>
                </form>
            </AlertDialogContent>
        </AlertDialog>
    );
}