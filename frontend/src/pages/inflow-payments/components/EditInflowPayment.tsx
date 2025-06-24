// src/pages/inflow-payments/components/EditInflowPayment.tsx

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
    useFrappeUpdateDoc, // Changed
    useFrappeFileUpload,
    useFrappeGetDocList,
    GetDocListArgs,
    FrappeDoc,
    useFrappeDocTypeEventListener
} from "frappe-react-sdk";
import memoize from 'lodash/memoize';
import { TailSpin } from "react-loader-spinner";
import { X as XIcon, Paperclip, Download as DownloadIcon, AlertTriangle } from "lucide-react"; // Added icons

// --- UI Components ---
import ProjectSelect from "@/components/custom-select/project-select"; // Assuming this is still used/needed
import { CustomAttachment, AcceptedFileType } from "@/components/helpers/CustomAttachment";
import {
    AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
    AlertDialogHeader, AlertDialogTitle, AlertDialogFooter, AlertDialogAction
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { Separator } from "@/components/ui/separator";
import SITEURL from "@/constants/siteURL";
import { cn } from "@/lib/utils";


// --- Types ---
import { ProjectInflows as ProjectInflowsType } from "@/types/NirmaanStack/ProjectInflows";
import { Projects } from "@/types/NirmaanStack/Projects";
import { Customers } from "@/types/NirmaanStack/Customers";

// --- Utils & State ---
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { getTotalInflowAmount } from "@/utils/getAmounts"; // May not be needed in edit form, but kept if used for display
import { parseNumber } from "@/utils/parseNumber";
import { useDialogStore } from "@/zustand/useDialogStore";
import { getProjectListOptions, queryKeys, getCustomerListOptions } from "@/config/queryKeys";
import { formatDate as formatDateFns } from "date-fns"; // Renamed from formatDate

interface EditInflowFormState {
    project: string; // Project might not be editable, or it might be. Assuming it's fixed.
    customer: string; // Customer might not be editable. Assuming it's fixed.
    project_name?: string;
    customer_name?: string;
    amount: string;
    payment_date: string; // YYYY-MM-DD
    utr: string;
}

const ATTACHMENT_ACCEPTED_TYPES: AcceptedFileType[] = ["image/*", "application/pdf", "text/csv", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"];
type AttachmentUpdateAction = "keep" | "replace" | "remove";


interface EditInflowPaymentProps {
    inflowToEdit: ProjectInflowsType;
    onSuccess?: () => void; // Parent handles refetch and closing
}

export const EditInflowPayment: React.FC<EditInflowPaymentProps> = ({ inflowToEdit, onSuccess }) => {
    const { editInflowDialog, setEditInflowDialog } = useDialogStore();
    const { toast } = useToast();

    const [formState, setFormState] = useState<EditInflowFormState>({
        project: inflowToEdit.project || "", customer: inflowToEdit.customer || "", amount: "", payment_date: "", utr: ""
    });
    const [newPaymentScreenshot, setNewPaymentScreenshot] = useState<File | null>(null);
    const [existingAttachmentUrl, setExistingAttachmentUrl] = useState<string | undefined>(inflowToEdit.inflow_attachment);
    const [attachmentAction, setAttachmentAction] = useState<AttachmentUpdateAction>(inflowToEdit.inflow_attachment ? "keep" : "remove");
    const [formErrors, setFormErrors] = useState<Partial<Record<keyof EditInflowFormState, string>>>({});

    // For displaying project/customer names, could fetch them or pass from parent if available
    const [projectName, setProjectName] = useState("");
    const [customerName, setCustomerName] = useState("");
    const [isProjectValid, setIsProjectValid] = useState(true); // Assume valid initially for edit

    const { updateDoc, loading: updateLoading } = useFrappeUpdateDoc(); // Changed
    const { upload, loading: uploadLoading } = useFrappeFileUpload();

    // Fetch supporting data (Projects, Customers) - this might be simplified if project/customer are not editable
    // If they are not editable, you can pass names as props or fetch just the single project/customer
    const { data: projects, isLoading: projectsLoading } = useFrappeGetDocList<Projects>("Projects", getProjectListOptions({ fields: ["name", "project_name", "customer"] }) as any, queryKeys.projects.list());
    const { data: customers, isLoading: customersLoading } = useFrappeGetDocList<Customers>("Customers", getCustomerListOptions({ fields: ["name", "company_name"] }) as any, queryKeys.customers.list());

    // Effect to populate form when inflowToEdit or dialog state changes
    useEffect(() => {
        if (editInflowDialog && inflowToEdit) {
            setFormState({
                project: inflowToEdit.project || "",
                customer: inflowToEdit.customer || "",
                project_name: "", // Will be set below
                customer_name: "", // Will be set below
                amount: inflowToEdit.amount?.toString() || "",
                payment_date: inflowToEdit.payment_date ? formatDateFns(new Date(inflowToEdit.payment_date), "yyyy-MM-dd") : formatDateFns(new Date(), "yyyy-MM-dd"),
                utr: inflowToEdit.utr || "",
            });
            setExistingAttachmentUrl(inflowToEdit.inflow_attachment);
            setAttachmentAction(inflowToEdit.inflow_attachment ? "keep" : "remove");
            setNewPaymentScreenshot(null);
            setFormErrors({});
            setIsProjectValid(!!inflowToEdit.customer); // Check if existing inflow had a customer

            // Set project and customer names for display
            const currentProject = projects?.find(p => p.name === inflowToEdit.project);
            if (currentProject) {
                setProjectName(currentProject.project_name);
                const currentCustomer = customers?.find(c => c.name === currentProject.customer);
                setCustomerName(currentCustomer?.company_name || (currentProject.customer ? "Customer not found" : "No Customer"));
                setFormState(prev => ({ ...prev, customer: currentProject.customer || "", project_name: currentProject.project_name, customer_name: currentCustomer?.company_name || "" }));
            } else if (inflowToEdit.project) { // Fallback if projects list not loaded yet
                setProjectName(inflowToEdit.project); // Show ID at least
                setFormState(prev => ({ ...prev, project_name: inflowToEdit.project }));
            }
            if (!currentProject?.customer && inflowToEdit.project) {
                toast({ title: "Warning", description: "The associated project does not have a customer linked. This inflow might be problematic.", variant: "default" });
            }


        }
    }, [editInflowDialog, inflowToEdit, projects, customers, toast]);


    // If Project/Customer are editable, you'd need handleProjectChange similar to NewInflowPayment
    // For now, assuming Project/Customer are fixed for an existing inflow.

    const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => { /* Same as NewInflowPayment */
        const { name, value } = e.target;
        setFormState(prev => ({ ...prev, [name]: value }));
        if (formErrors[name as keyof EditInflowFormState]) {
            setFormErrors(prev => ({ ...prev, [name]: undefined }));
        }
    }, [formErrors]);

    const validateForm = useCallback((): boolean => { /* Similar to NewInflowPayment, project/customer might not need validation if fixed */
        const errors: Partial<Record<keyof EditInflowFormState, string>> = {};
        if (!formState.project) errors.project = "Project is required (should be pre-filled).";
        if (!isProjectValid) errors.project = "Associated project must have a customer."; // This check might be more of a warning for edit
        if (!formState.amount || parseNumber(formState.amount) <= 0) errors.amount = "Valid amount is required.";
        if (!formState.utr.trim()) errors.utr = "Payment Reference (UTR) is required.";
        if (!formState.payment_date) errors.payment_date = "Payment date is required.";
        setFormErrors(errors);
        return Object.keys(errors).length === 0;
    }, [formState, isProjectValid]);

    const handleNewFileSelected = (file: File | null) => {
        setNewPaymentScreenshot(file);
        setAttachmentAction(file ? "replace" : (existingAttachmentUrl ? "keep" : "remove"));
    };
    const handleRemoveExistingAttachment = () => {
        setNewPaymentScreenshot(null);
        setAttachmentAction("remove");
    };
    const handleAttachmentError = useCallback(({ message }: { type: "size" | "type", message: string }) => {
        toast({ title: "Attachment Error", description: message, variant: "destructive" });
    }, [toast]);


    const handleSubmitPayment = useCallback(async () => {
        if (!validateForm()) {
            toast({ title: "Validation Error", description: "Please correct the errors in the form.", variant: "destructive" });
            return;
        }

        const dataToUpdate: Partial<ProjectInflowsType> = {
            // Project and customer are assumed fixed for this edit form
            // project: formState.project,
            // customer: formState.customer,
            amount: parseNumber(formState.amount),
            payment_date: formState.payment_date,
            utr: formState.utr.trim(),
        };

        try {
            if (attachmentAction === "replace" && newPaymentScreenshot) {
                const uploadedFile = await upload(newPaymentScreenshot, {
                    doctype: "Project Inflows", docname: inflowToEdit.name,
                    fieldname: "inflow_attachment", isPrivate: true, // Match your privacy settings
                });
                dataToUpdate.inflow_attachment = uploadedFile.file_url;
            } else if (attachmentAction === "remove") {
                dataToUpdate.inflow_attachment = null; // Send null to clear the field
            }
            // If action is "keep", inflow_attachment is not included in dataToUpdate, Frappe retains current value.

            await updateDoc("Project Inflows", inflowToEdit.name, dataToUpdate);
            toast({ title: "Success!", description: "Inflow payment updated successfully!", variant: "success" });
            onSuccess?.(); // Parent handles refetch and close
        } catch (error: any) {
            console.error("Error updating inflow payment:", error);
            toast({ title: "Failed!", description: error.message || "Failed to update payment.", variant: "destructive" });
        }
    }, [updateDoc, inflowToEdit.name, formState, newPaymentScreenshot, attachmentAction, upload, validateForm, toast, onSuccess]);

    const handleDialogCloseAttempt = () => {
        // Reset local form states, but the dialog's open state is controlled by parent via Zustand
        setFormState({ project: "", customer: "", amount: "", payment_date: "", utr: "" });
        setFormErrors({});
        setNewPaymentScreenshot(null);
        setExistingAttachmentUrl(undefined);
        setAttachmentAction("keep");
    };

    const isLoadingAny = updateLoading || uploadLoading || projectsLoading || customersLoading;
    const isSubmitDisabled = isLoadingAny || !formState.project || !formState.amount || !formState.utr || !formState.payment_date || !isProjectValid;

    // Attachment Display (copied from UpdatePaymentDetailsDialog and adapted)
    let currentAttachmentDisplay: React.ReactNode = null;
    const effectiveExistingUrl = (attachmentAction === "keep" || attachmentAction === "replace") && existingAttachmentUrl;
    if (newPaymentScreenshot) {
        currentAttachmentDisplay = ( /* ... New file display ... */ <div className="flex items-center justify-between p-2 bg-blue-50 dark:bg-blue-900/30 rounded-md text-sm border border-blue-200 dark:border-blue-700"><div className="flex items-center gap-2 min-w-0"><Paperclip className="h-4 w-4 text-blue-600 dark:text-blue-400 flex-shrink-0" /><span className="truncate" title={newPaymentScreenshot.name}>{newPaymentScreenshot.name}</span><span className="text-xs text-blue-500 dark:text-blue-500 ml-1 whitespace-nowrap">(New)</span></div></div>);
    } else if (effectiveExistingUrl) {
        currentAttachmentDisplay = ( /* ... Existing file display ... */ <div className="flex items-center justify-between p-2 bg-muted/60 rounded-md text-sm"><div className="flex items-center gap-2 min-w-0"><DownloadIcon className="h-4 w-4 text-primary flex-shrink-0" /><a href={SITEURL + effectiveExistingUrl} target="_blank" rel="noopener noreferrer" className="truncate hover:underline" title={`View ${effectiveExistingUrl.split('/').pop()}`}>{effectiveExistingUrl.split('/').pop()}</a></div><Button variant="ghost" size="icon" onClick={handleRemoveExistingAttachment} className="h-7 w-7 text-destructive hover:bg-destructive/10"><XIcon className="h-4 w-4" /><span className="sr-only">Remove</span></Button></div>);
    } else if (attachmentAction === "remove" && existingAttachmentUrl) {
        currentAttachmentDisplay = ( /* ... Marked for removal ... */ <div className="flex items-center gap-2 p-2 bg-amber-50 dark:bg-amber-900/30 rounded-md text-sm text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-700"><AlertTriangle className="h-4 w-4 flex-shrink-0" /><span>Attachment will be removed.</span></div>);
    }


    return (
        <AlertDialog
            open={editInflowDialog}
            onOpenChange={(isOpen) => {
                setEditInflowDialog(isOpen);
                if (!isOpen) handleDialogCloseAttempt();
            }}
        >
            <AlertDialogContent className="max-w-lg">
                <AlertDialogHeader>
                    <AlertDialogTitle className="text-center text-xl">Edit Inflow Payment</AlertDialogTitle>
                    <AlertDialogDescription className="text-center">ID: {inflowToEdit.name}</AlertDialogDescription>
                    <Separator className="my-4" />
                </AlertDialogHeader>
                <div className="space-y-4 py-2">
                    {/* Project and Customer - Display only, assuming not editable here */}
                    <div className="grid grid-cols-3 items-center gap-4">
                        <Label htmlFor="project_edit_inflow" className="text-right">Project</Label>
                        <Input id="project_edit_inflow" value={projectName || formState.project} disabled className="col-span-2 h-9 bg-muted/50" />
                    </div>
                    <div className="grid grid-cols-3 items-center gap-4">
                        <Label htmlFor="customer_edit_inflow" className="text-right">Customer</Label>
                        <Input id="customer_edit_inflow" value={customerName || (formState.project && !isProjectValid ? "No Customer Linked" : "--")} disabled className="col-span-2 h-9 bg-muted/50" />
                    </div>
                    {/* No Total Received for project as this is an individual inflow edit */}
                    <Separator className="my-4" />

                    <div className="grid grid-cols-3 items-center gap-4">
                        <Label htmlFor="amount_edit_inflow" className="text-right">Amount <sup className="text-destructive">*</sup></Label>
                        <Input id="amount_edit_inflow" name="amount" type="number" placeholder="Enter Amount" value={formState.amount} onChange={handleInputChange} className="col-span-2 h-9" disabled={isLoadingAny} />
                        {formErrors.amount && <p className="col-span-3 col-start-2 text-xs text-destructive mt-1">{formErrors.amount}</p>}
                    </div>
                    <div className="grid grid-cols-3 items-center gap-4">
                        <Label htmlFor="utr_edit_inflow" className="text-right">Payment Ref (UTR) <sup className="text-destructive">*</sup></Label>
                        <Input id="utr_edit_inflow" name="utr" type="text" placeholder="Enter UTR/Ref No." value={formState.utr} onChange={handleInputChange} className="col-span-2 h-9" disabled={isLoadingAny} />
                        {formErrors.utr && <p className="col-span-3 col-start-2 text-xs text-destructive mt-1">{formErrors.utr}</p>}
                    </div>
                    <div className="grid grid-cols-3 items-center gap-4">
                        <Label htmlFor="payment_date_edit_inflow" className="text-right">Payment Date <sup className="text-destructive">*</sup></Label>
                        <Input id="payment_date_edit_inflow" name="payment_date" type="date" value={formState.payment_date} onChange={handleInputChange} max={formatDateFns(new Date(), "yyyy-MM-dd")} className="col-span-2 h-9" disabled={isLoadingAny} />
                        {formErrors.payment_date && <p className="col-span-3 col-start-2 text-xs text-destructive mt-1">{formErrors.payment_date}</p>}
                    </div>

                    {/* Attachment Section for Edit */}
                    <div className="grid grid-cols-3 items-start gap-3">
                        <Label className="text-right col-span-1 pt-2">Payment Proof</Label>
                        <div className="col-span-2 space-y-2">
                            {currentAttachmentDisplay}
                            {(!newPaymentScreenshot && (attachmentAction === "remove" || !existingAttachmentUrl)) && (
                                <CustomAttachment label="Upload New Proof" selectedFile={newPaymentScreenshot} onFileSelect={handleNewFileSelected} onError={handleAttachmentError} maxFileSize={5 * 1024 * 1024} acceptedTypes={ATTACHMENT_ACCEPTED_TYPES} disabled={isLoadingAny} />
                            )}
                            {!newPaymentScreenshot && existingAttachmentUrl && attachmentAction === "keep" && (
                                <CustomAttachment label="Replace Proof" selectedFile={null} onFileSelect={handleNewFileSelected} onError={handleAttachmentError} maxFileSize={5 * 1024 * 1024} acceptedTypes={ATTACHMENT_ACCEPTED_TYPES} disabled={isLoadingAny} />
                            )}
                        </div>
                    </div>
                </div>
                <AlertDialogFooter className="pt-6">
                    {isLoadingAny ? (
                        <div className="flex justify-center w-full"><TailSpin color="#4f46e5" height={28} width={28} /></div>
                    ) : (
                        <>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <Button onClick={handleSubmitPayment} disabled={isSubmitDisabled}>Save Changes</Button>
                        </>
                    )}
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
};