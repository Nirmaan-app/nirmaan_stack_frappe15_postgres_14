
// src/components/project-invoices/components/ProjectInvoiceDialog.tsx (or your file path)
import { CustomAttachment } from "@/components/helpers/CustomAttachment";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/use-toast";
import { ProjectInvoice } from "@/types/NirmaanStack/ProjectInvoice";
import { parseNumber } from "@/utils/parseNumber";
import { useDialogStore } from "@/zustand/useDialogStore";
import { useFrappeCreateDoc, useFrappeDeleteDoc, useFrappeFileUpload } from "frappe-react-sdk";
import React, { useCallback, useState, useEffect, useContext } from "react";
import { TailSpin } from "react-loader-spinner";
import { KeyedMutator } from 'swr';

import { UserContext } from "@/utils/auth/UserProvider";
import ProjectSelect from "@/components/custom-select/project-select";


interface ProjectInvoiceDialogProps {
    listMutate: KeyedMutator<ProjectInvoice[]>;
    ProjectId?: string; // Optional to handle cases where it might not be available
}

export function ProjectInvoiceDialog({ listMutate, ProjectId }: ProjectInvoiceDialogProps) {
    const { toggleNewProjectInvoiceDialog, newProjectInvoiceDialog } = useDialogStore();
    const { selectedProject, setSelectedProject } = useContext(UserContext)


    // Define the initial state for the form fields
    const getInitialState = () => ({
        invoice_no: "",
        amount: "",
        date: "",
        project: ProjectId || ""
    });

    const [invoiceData, setInvoiceData] = useState(getInitialState());
    const [selectedAttachment, setSelectedAttachment] = useState<File | null>(null);

    const { createDoc, loading: createDocLoading } = useFrappeCreateDoc();

    const { upload, loading: uploadLoading } = useFrappeFileUpload();

    // Effect to reset the form state when the dialog is closed
    useEffect(() => {
        if (!newProjectInvoiceDialog) {
            setInvoiceData(getInitialState());
            setSelectedAttachment(null);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [newProjectInvoiceDialog, ProjectId]); // Reset if ProjectId changes while dialog is open

    const handleSubmitInvoice = useCallback(async (event?: React.FormEvent) => {
        if (event) event.preventDefault(); // Prevent default form submission

        if (!invoiceData.date || !invoiceData.invoice_no || !invoiceData.amount || !invoiceData.project) {
            toast({ title: "Validation Error", description: "Please fill all required fields.", variant: "destructive" });
            return;
        }
        if (!selectedAttachment) {
            toast({ title: "Validation Error", description: "Please attach the invoice file.", variant: "destructive" });
            return;
        }

        try {
            let fileUrl: string | undefined = undefined;

            if (selectedAttachment) {
                // Frappe requires a temporary docname if the main doc isn't created yet for file attachment.
                // Using a placeholder; the file will be re-linked upon successful doc creation if needed,
                // or a better approach is to create doc first, then attach.
                // For simplicity with createDoc, we'll create, then update with file URL if needed.
                const tempDocName = `temp-proj-inv-${Date.now()}`; // Temporary name
                const fileArgs = {
                    doctype: "Project Invoices", // Target doctype
                    docname: tempDocName,      // Temporary name, file is public by default
                    fieldname: "attachment", // Field to attach to
                    // file: paymentScreenshot,
                    isPrivate: true, // Make it private
                };
                const uploadedFile = await upload(selectedAttachment, fileArgs);
                fileUrl = uploadedFile.file_url;
            }

            if (!fileUrl) {
                throw new Error("File upload succeeded but did not return a URL.");
            }

            const newInvoicePayload: Omit<ProjectInvoice, 'name' | 'owner' | 'creation' | 'modified'> = {
                invoice_no: invoiceData.invoice_no,
                amount: parseNumber(invoiceData.amount),
                invoice_date: invoiceData.date,
                attachment: fileUrl,
                project: invoiceData.project || ProjectId, // Fallback to ProjectId prop if invoiceData.project is somehow empty
            };

            await createDoc("Project Invoices", newInvoicePayload);

            toast({
                title: "Success!",
                description: `Invoice ${invoiceData.invoice_no} created successfully.`,
                variant: "success"
            });

            await listMutate();
            toggleNewProjectInvoiceDialog();
            setSelectedAttachment(null)
            getInitialState()
            sessionStorage.removeItem("selectedProject");

        } catch (error) {
            console.error("Error creating Invoice:", error);
            sessionStorage.removeItem("selectedProject");
            toast({
                title: "Creation Failed",
                description: error instanceof Error ? error.message : "An unexpected error occurred.",
                variant: "destructive"
            });
        }
    }, [
        invoiceData,
        selectedAttachment,
        ProjectId,
        upload,
        createDoc,
        listMutate,
        toggleNewProjectInvoiceDialog,
    ]);

    const isLoading = uploadLoading || createDocLoading;

    // Derived state to check if the form is valid for submission
    const isFormInvalid = !invoiceData.date || !invoiceData.invoice_no || !invoiceData.amount || !selectedAttachment;

    const handleChange = (selectedItem: any) => {
        setSelectedProject(selectedItem ? selectedItem.value : null);
        if (selectedItem) {
            sessionStorage.setItem(
                "selectedProject",
                JSON.stringify(selectedItem.value)
            );
            setInvoiceData(prev => ({
                ...prev,
                project: selectedItem ? selectedItem.value : ""
            }));

        } else {
            sessionStorage.removeItem("selectedProject");
        }
    };
    return (
        <AlertDialog open={newProjectInvoiceDialog} onOpenChange={!isLoading ? toggleNewProjectInvoiceDialog : undefined}>
            <AlertDialogContent className="sm:max-w-lg">
                <AlertDialogHeader>
                    <AlertDialogTitle className="text-center text-xl">Add New Invoice</AlertDialogTitle>
                </AlertDialogHeader>

                {/* Use a form for semantic correctness and better event handling */}
                <form onSubmit={handleSubmitInvoice} className="space-y-6 pt-4">

                    {/* Responsive grid for form fields */}
                    <div className="space-y-4">
                        {/* Invoice No. Field */}
                        {!ProjectId && (<div className="grid grid-cols-1 items-start gap-2 sm:grid-cols-3 sm:items-center sm:gap-4">
                            <Label htmlFor="invoice_no" className="sm:text-left">
                                Project Select<sup className="text-red-500 ml-1">* </sup>:
                            </Label>
                            <div className="sm:col-span-2">
                                <ProjectSelect onChange={handleChange} />

                            </div>
                        </div>)}

                        <div className="grid grid-cols-1 items-start gap-2 sm:grid-cols-3 sm:items-center sm:gap-4">
                            <Label htmlFor="invoice_no" className="sm:text-left">
                                Invoice No<sup className="text-red-500 ml-1">* </sup>:
                            </Label>
                            <Input
                                id="invoice_no"
                                value={invoiceData.invoice_no}
                                onChange={(e) => setInvoiceData((prev) => ({ ...prev, invoice_no: e.target.value }))}
                                className="sm:col-span-2"
                                disabled={isLoading}
                            />
                        </div>

                        {/* Date Field */}
                        <div className="grid grid-cols-1 items-start gap-2 sm:grid-cols-3 sm:items-center sm:gap-4">
                            <Label htmlFor="invoice_date" className="sm:text-left">
                                Date<sup className="text-red-500 ml-1">*</sup>:
                            </Label>
                            <Input
                                id="invoice_date"
                                type="date"
                                value={invoiceData.date}
                                onChange={(e) => setInvoiceData((prev) => ({ ...prev, date: e.target.value }))}
                                max={new Date().toISOString().split("T")[0]}
                                className="sm:col-span-2"
                                disabled={isLoading}
                            />
                        </div>

                        {/* Amount Field */}
                        <div className="grid grid-cols-1 items-start gap-2 sm:grid-cols-3 sm:items-center sm:gap-4">
                            <Label htmlFor="invoice_amount" className="sm:text-left">
                                Amount(Incl. GST)<sup className="text-red-500 ml-1">*</sup>:
                            </Label>
                            <Input
                                id="invoice_amount"
                                type="text"
                                inputMode="decimal"
                                value={invoiceData.amount}
                                onChange={(e) => {
                                    const value = e.target.value;
                                    // Regex to allow only numbers and a single decimal point
                                    if (/^\d*\.?\d*$/.test(value)) {
                                        setInvoiceData((prev) => ({ ...prev, amount: value }));
                                    }
                                }}
                                className="sm:col-span-2"
                                disabled={isLoading}
                            />
                        </div>
                    </div>

                    {/* Attachment Component */}
                    <CustomAttachment
                        selectedFile={selectedAttachment}
                        onFileSelect={setSelectedAttachment}
                        label="Attach Invoice"
                        disabled={isLoading}
                        isRequired={true}
                    />

                    {/* Action Buttons */}
                    <div className="flex gap-2 items-center pt-4 justify-end">
                        {isLoading ? (
                            <div className='flex justify-center items-center w-full h-10'>
                                <TailSpin color="red" width={30} height={30} />
                            </div>
                        ) : (
                            <>
                                <AlertDialogCancel asChild>
                                    <Button variant="outline" disabled={isLoading}>Cancel</Button>
                                </AlertDialogCancel>
                                <Button type="submit" disabled={isFormInvalid || isLoading}>
                                    Confirm
                                </Button>
                            </>
                        )}
                    </div>
                </form>
            </AlertDialogContent>
        </AlertDialog>
    );
}
