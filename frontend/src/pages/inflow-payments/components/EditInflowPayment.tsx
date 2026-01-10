// src/pages/inflow-payments/components/EditInflowPayment.tsx

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
    useFrappeUpdateDoc,
    useFrappeFileUpload,
    useFrappeGetDocList,
    GetDocListArgs,
    FrappeDoc,
    useFrappeDocTypeEventListener
} from "frappe-react-sdk";
import memoize from 'lodash/memoize';
import { TailSpin } from "react-loader-spinner";
import {
    AlertCircle,
    X as XIcon,
    Paperclip,
    Download as DownloadIcon,
    AlertTriangle,
    Pencil,
    Building2,
    Calendar,
    Hash,
    IndianRupee,
    FileText,
    Save,
    ExternalLink,
    Trash2,
    Upload
} from "lucide-react";

// --- UI Components ---
import ProjectSelect from "@/components/custom-select/project-select";
import { CustomAttachment, AcceptedFileType } from "@/components/helpers/CustomAttachment";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { getTotalInflowAmount } from "@/utils/getAmounts";
import { parseNumber } from "@/utils/parseNumber";
import { useDialogStore } from "@/zustand/useDialogStore";
import { getProjectListOptions, queryKeys, getCustomerListOptions } from "@/config/queryKeys";
import { formatDate as formatDateFns } from "date-fns";

interface EditInflowFormState {
    project: string;
    customer: string;
    project_name?: string;
    customer_name?: string;
    amount: string;
    payment_date: string;
    utr: string;
}

const ATTACHMENT_ACCEPTED_TYPES: AcceptedFileType[] = ["image/*", "application/pdf", "text/csv", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"];
type AttachmentUpdateAction = "keep" | "replace" | "remove";


interface EditInflowPaymentProps {
    inflowToEdit: ProjectInflowsType;
    onSuccess?: () => void;
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

    const [projectName, setProjectName] = useState("");
    const [customerName, setCustomerName] = useState("");
    const [isProjectValid, setIsProjectValid] = useState(true);

    const { updateDoc, loading: updateLoading } = useFrappeUpdateDoc();
    const { upload, loading: uploadLoading } = useFrappeFileUpload();

    const { data: projects, isLoading: projectsLoading } = useFrappeGetDocList<Projects>("Projects", getProjectListOptions({ fields: ["name", "project_name", "customer"] }) as any, queryKeys.projects.list());
    const { data: customers, isLoading: customersLoading } = useFrappeGetDocList<Customers>("Customers", getCustomerListOptions({ fields: ["name", "company_name"] }) as any, queryKeys.customers.list());

    useEffect(() => {
        if (editInflowDialog && inflowToEdit) {
            setFormState({
                project: inflowToEdit.project || "",
                customer: inflowToEdit.customer || "",
                project_name: "",
                customer_name: "",
                amount: inflowToEdit.amount?.toString() || "",
                payment_date: inflowToEdit.payment_date ? formatDateFns(new Date(inflowToEdit.payment_date), "yyyy-MM-dd") : formatDateFns(new Date(), "yyyy-MM-dd"),
                utr: inflowToEdit.utr || "",
            });
            setExistingAttachmentUrl(inflowToEdit.inflow_attachment);
            setAttachmentAction(inflowToEdit.inflow_attachment ? "keep" : "remove");
            setNewPaymentScreenshot(null);
            setFormErrors({});
            setIsProjectValid(!!inflowToEdit.customer);

            const currentProject = projects?.find(p => p.name === inflowToEdit.project);
            if (currentProject) {
                setProjectName(currentProject.project_name);
                const currentCustomer = customers?.find(c => c.name === currentProject.customer);
                setCustomerName(currentCustomer?.company_name || (currentProject.customer ? "Customer not found" : "No Customer"));
                setFormState(prev => ({ ...prev, customer: currentProject.customer || "", project_name: currentProject.project_name, customer_name: currentCustomer?.company_name || "" }));
            } else if (inflowToEdit.project) {
                setProjectName(inflowToEdit.project);
                setFormState(prev => ({ ...prev, project_name: inflowToEdit.project }));
            }
            if (!currentProject?.customer && inflowToEdit.project) {
                toast({ title: "Warning", description: "The associated project does not have a customer linked. This inflow might be problematic.", variant: "default" });
            }
        }
    }, [editInflowDialog, inflowToEdit, projects, customers, toast]);

    const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setFormState(prev => ({ ...prev, [name]: value }));
        if (formErrors[name as keyof EditInflowFormState]) {
            setFormErrors(prev => ({ ...prev, [name]: undefined }));
        }
    }, [formErrors]);

    const validateForm = useCallback((): boolean => {
        const errors: Partial<Record<keyof EditInflowFormState, string>> = {};
        if (!formState.project) errors.project = "Project is required (should be pre-filled).";
        if (!isProjectValid) errors.project = "Associated project must have a customer.";
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
            amount: parseNumber(formState.amount),
            payment_date: formState.payment_date,
            utr: formState.utr.trim(),
        };

        try {
            if (attachmentAction === "replace" && newPaymentScreenshot) {
                const uploadedFile = await upload(newPaymentScreenshot, {
                    doctype: "Project Inflows", docname: inflowToEdit.name,
                    fieldname: "inflow_attachment", isPrivate: true,
                });
                dataToUpdate.inflow_attachment = uploadedFile.file_url;
            } else if (attachmentAction === "remove") {
                dataToUpdate.inflow_attachment = null;
            }

            await updateDoc("Project Inflows", inflowToEdit.name, dataToUpdate);
            toast({ title: "Success!", description: "Inflow payment updated successfully!", variant: "success" });
            onSuccess?.();
        } catch (error: any) {
            console.error("Error updating inflow payment:", error);
            toast({ title: "Failed!", description: error.message || "Failed to update payment.", variant: "destructive" });
        }
    }, [updateDoc, inflowToEdit.name, formState, newPaymentScreenshot, attachmentAction, upload, validateForm, toast, onSuccess]);

    const handleDialogCloseAttempt = () => {
        setFormState({ project: "", customer: "", amount: "", payment_date: "", utr: "" });
        setFormErrors({});
        setNewPaymentScreenshot(null);
        setExistingAttachmentUrl(undefined);
        setAttachmentAction("keep");
    };

    const isLoadingAny = updateLoading || uploadLoading || projectsLoading || customersLoading;
    const isSubmitDisabled = isLoadingAny || !formState.project || !formState.amount || !formState.utr || !formState.payment_date || !isProjectValid;

    // Get filename from URL and truncate to maxLength
    const getFileName = (url: string, maxLength: number = 25) => {
        const parts = url.split('/');
        const filename = parts[parts.length - 1] || 'attachment';
        if (filename.length <= maxLength) return filename;
        const ext = filename.lastIndexOf('.') > 0 ? filename.slice(filename.lastIndexOf('.')) : '';
        const nameWithoutExt = filename.slice(0, filename.lastIndexOf('.') > 0 ? filename.lastIndexOf('.') : filename.length);
        const truncatedName = nameWithoutExt.slice(0, maxLength - ext.length - 3) + '...' + ext;
        return truncatedName;
    };

    return (
        <AlertDialog
            open={editInflowDialog}
            onOpenChange={(isOpen) => {
                setEditInflowDialog(isOpen);
                if (!isOpen) handleDialogCloseAttempt();
            }}
        >
            <AlertDialogContent className="max-w-[480px] p-0 gap-0 overflow-hidden border-0 shadow-2xl">
                {/* Header */}
                <div className="bg-gradient-to-br from-slate-800 via-slate-700 to-slate-800 px-6 py-5">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="flex items-center justify-center w-10 h-10 rounded-full bg-amber-500/20 ring-1 ring-amber-500/30">
                                <Pencil className="w-5 h-5 text-amber-400" />
                            </div>
                            <div>
                                <AlertDialogTitle className="text-lg font-semibold text-white tracking-tight">
                                    Edit Inflow Payment
                                </AlertDialogTitle>
                                <p className="text-xs text-slate-400 mt-0.5">
                                    Modify payment details
                                </p>
                            </div>
                        </div>
                        <div className="px-2.5 py-1 rounded-md bg-slate-600/50 border border-slate-500/30">
                            <p className="text-[10px] font-mono text-slate-300">{inflowToEdit.name}</p>
                        </div>
                    </div>
                </div>

                {/* Body */}
                <div className="px-6 py-5 space-y-5 bg-white dark:bg-slate-950">
                    {/* Project Context Section - Read Only */}
                    <div className="space-y-3">
                        <div className="flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                            <Building2 className="w-3.5 h-3.5" />
                            Payment Context
                        </div>

                        {/* Project & Customer Badges */}
                        <div className="grid grid-cols-2 gap-3">
                            <div className="rounded-lg px-3 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                                <p className="text-[10px] font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-0.5">
                                    Project
                                </p>
                                <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate" title={projectName || formState.project}>
                                    {projectName || formState.project || "--"}
                                </p>
                            </div>
                            <div className={cn(
                                "rounded-lg px-3 py-2.5 border transition-colors",
                                isProjectValid
                                    ? "bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800"
                                    : "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800"
                            )}>
                                <p className="text-[10px] font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-0.5">
                                    Customer
                                </p>
                                <p className={cn(
                                    "text-sm font-medium truncate",
                                    isProjectValid
                                        ? "text-slate-900 dark:text-slate-100"
                                        : "text-amber-700 dark:text-amber-400"
                                )}>
                                    {customerName || "No Customer"}
                                </p>
                            </div>
                        </div>

                        {/* Warning Alert */}
                        {formState.project && !isProjectValid && (
                            <Alert className="bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800 py-3">
                                <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                                <AlertDescription className="text-amber-700 dark:text-amber-300 text-xs leading-relaxed">
                                    This project has no customer assigned. Please update the project details first.
                                </AlertDescription>
                            </Alert>
                        )}
                    </div>

                    {/* Divider */}
                    <div className="relative">
                        <div className="absolute inset-0 flex items-center">
                            <div className="w-full border-t border-slate-200 dark:border-slate-800" />
                        </div>
                        <div className="relative flex justify-center">
                            <span className="bg-white dark:bg-slate-950 px-3 text-xs font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                                Payment Details
                            </span>
                        </div>
                    </div>

                    {/* Payment Details Section */}
                    <div className="space-y-4">
                        {/* Amount */}
                        <div className="space-y-1.5">
                            <Label htmlFor="amount" className="text-sm font-medium text-slate-700 dark:text-slate-300 flex items-center gap-2">
                                <IndianRupee className="w-3.5 h-3.5 text-slate-400" />
                                Amount <span className="text-red-500">*</span>
                            </Label>
                            <div className="relative">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm font-medium">₹</span>
                                <Input
                                    id="amount"
                                    name="amount"
                                    type="number"
                                    placeholder="0.00"
                                    value={formState.amount}
                                    onChange={handleInputChange}
                                    disabled={isLoadingAny}
                                    className={cn(
                                        "pl-7 h-10 text-base font-medium transition-all",
                                        "focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500",
                                        formErrors.amount && "border-red-300 focus:border-red-500 focus:ring-red-500/20"
                                    )}
                                />
                            </div>
                            {formErrors.amount && (
                                <p className="text-xs text-red-500 flex items-center gap-1">
                                    <AlertCircle className="w-3 h-3" />
                                    {formErrors.amount}
                                </p>
                            )}
                        </div>

                        {/* UTR and Date - Side by side */}
                        <div className="grid grid-cols-2 gap-3">
                            {/* UTR */}
                            <div className="space-y-1.5">
                                <Label htmlFor="utr" className="text-sm font-medium text-slate-700 dark:text-slate-300 flex items-center gap-2">
                                    <Hash className="w-3.5 h-3.5 text-slate-400" />
                                    UTR/Ref <span className="text-red-500">*</span>
                                </Label>
                                <Input
                                    id="utr"
                                    name="utr"
                                    type="text"
                                    placeholder="Reference No."
                                    value={formState.utr}
                                    onChange={handleInputChange}
                                    disabled={isLoadingAny}
                                    className={cn(
                                        "h-10 transition-all",
                                        "focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500",
                                        formErrors.utr && "border-red-300 focus:border-red-500 focus:ring-red-500/20"
                                    )}
                                />
                                {formErrors.utr && (
                                    <p className="text-xs text-red-500 flex items-center gap-1">
                                        <AlertCircle className="w-3 h-3" />
                                        {formErrors.utr}
                                    </p>
                                )}
                            </div>

                            {/* Payment Date */}
                            <div className="space-y-1.5">
                                <Label htmlFor="payment_date" className="text-sm font-medium text-slate-700 dark:text-slate-300 flex items-center gap-2">
                                    <Calendar className="w-3.5 h-3.5 text-slate-400" />
                                    Date <span className="text-red-500">*</span>
                                </Label>
                                <Input
                                    id="payment_date"
                                    name="payment_date"
                                    type="date"
                                    value={formState.payment_date}
                                    onChange={handleInputChange}
                                    disabled={isLoadingAny}
                                    max={formatDateFns(new Date(), "yyyy-MM-dd")}
                                    className={cn(
                                        "h-10 transition-all",
                                        "focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500",
                                        formErrors.payment_date && "border-red-300 focus:border-red-500 focus:ring-red-500/20"
                                    )}
                                />
                                {formErrors.payment_date && (
                                    <p className="text-xs text-red-500 flex items-center gap-1">
                                        <AlertCircle className="w-3 h-3" />
                                        {formErrors.payment_date}
                                    </p>
                                )}
                            </div>
                        </div>

                        {/* Attachment Section */}
                        <div className="space-y-2">
                            <Label className="text-sm font-medium text-slate-700 dark:text-slate-300 flex items-center gap-2">
                                <FileText className="w-3.5 h-3.5 text-slate-400" />
                                Payment Proof
                                <span className="text-xs font-normal text-slate-400">(Optional)</span>
                            </Label>

                            {/* New file selected */}
                            {newPaymentScreenshot && (
                                <div className="flex items-center justify-between p-3 bg-blue-50 dark:bg-blue-950/30 rounded-lg border border-blue-200 dark:border-blue-800">
                                    <div className="flex items-center gap-2 min-w-0">
                                        <div className="flex items-center justify-center w-8 h-8 rounded-md bg-blue-100 dark:bg-blue-900/50">
                                            <Paperclip className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                                        </div>
                                        <div className="min-w-0">
                                            <p className="text-sm font-medium text-blue-900 dark:text-blue-100 truncate">
                                                {newPaymentScreenshot.name.length > 25
                                                    ? newPaymentScreenshot.name.slice(0, 22) + '...'
                                                    : newPaymentScreenshot.name}
                                            </p>
                                            <p className="text-xs text-blue-600 dark:text-blue-400">New file selected</p>
                                        </div>
                                    </div>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => setNewPaymentScreenshot(null)}
                                        className="h-8 w-8 text-blue-600 hover:text-blue-700 hover:bg-blue-100 dark:hover:bg-blue-900/50"
                                    >
                                        <XIcon className="h-4 w-4" />
                                    </Button>
                                </div>
                            )}

                            {/* Existing attachment */}
                            {!newPaymentScreenshot && existingAttachmentUrl && attachmentAction === "keep" && (
                                <div className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800">
                                    <div className="flex items-center gap-2 min-w-0">
                                        <div className="flex items-center justify-center w-8 h-8 rounded-md bg-slate-100 dark:bg-slate-800">
                                            <FileText className="h-4 w-4 text-slate-600 dark:text-slate-400" />
                                        </div>
                                        <div className="min-w-0">
                                            <a
                                                href={SITEURL + existingAttachmentUrl}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-sm font-medium text-slate-900 dark:text-slate-100 hover:text-blue-600 dark:hover:text-blue-400 truncate flex items-center gap-1"
                                            >
                                                {getFileName(existingAttachmentUrl)}
                                                <ExternalLink className="w-3 h-3 flex-shrink-0" />
                                            </a>
                                            <p className="text-xs text-slate-500">Current attachment</p>
                                        </div>
                                    </div>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={handleRemoveExistingAttachment}
                                        className="h-8 w-8 text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </div>
                            )}

                            {/* Marked for removal */}
                            {!newPaymentScreenshot && attachmentAction === "remove" && existingAttachmentUrl && (
                                <div className="flex items-center gap-2 p-3 bg-amber-50 dark:bg-amber-950/30 rounded-lg border border-amber-200 dark:border-amber-800">
                                    <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 flex-shrink-0" />
                                    <p className="text-sm text-amber-700 dark:text-amber-300">
                                        Attachment will be removed on save
                                    </p>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => setAttachmentAction("keep")}
                                        className="ml-auto h-7 text-xs text-amber-700 hover:text-amber-800 hover:bg-amber-100 dark:hover:bg-amber-900/30"
                                    >
                                        Undo
                                    </Button>
                                </div>
                            )}

                            {/* Upload new attachment */}
                            {!newPaymentScreenshot && (attachmentAction === "remove" || !existingAttachmentUrl) && (
                                <CustomAttachment
                                    selectedFile={newPaymentScreenshot}
                                    onFileSelect={handleNewFileSelected}
                                    onError={handleAttachmentError}
                                    maxFileSize={5 * 1024 * 1024}
                                    acceptedTypes={ATTACHMENT_ACCEPTED_TYPES}
                                    disabled={isLoadingAny}
                                />
                            )}

                            {/* Replace option when keeping existing */}
                            {!newPaymentScreenshot && existingAttachmentUrl && attachmentAction === "keep" && (
                                <CustomAttachment
                                    label="Replace with new file"
                                    selectedFile={null}
                                    onFileSelect={handleNewFileSelected}
                                    onError={handleAttachmentError}
                                    maxFileSize={5 * 1024 * 1024}
                                    acceptedTypes={ATTACHMENT_ACCEPTED_TYPES}
                                    disabled={isLoadingAny}
                                />
                            )}
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="px-6 py-4 bg-slate-50 dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800">
                    {isLoadingAny ? (
                        <div className="flex items-center justify-center gap-3 py-1">
                            <TailSpin color="#f59e0b" height={24} width={24} />
                            <span className="text-sm text-slate-500">Saving changes...</span>
                        </div>
                    ) : (
                        <div className="flex items-center justify-end gap-3">
                            <AlertDialogCancel className="h-10 px-4 text-sm font-medium bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 border-slate-200 dark:border-slate-700">
                                Cancel
                            </AlertDialogCancel>
                            <Button
                                onClick={handleSubmitPayment}
                                disabled={isSubmitDisabled}
                                className={cn(
                                    "h-10 px-5 text-sm font-medium",
                                    "bg-amber-600 hover:bg-amber-700 text-white",
                                    "shadow-sm shadow-amber-600/20",
                                    "disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none",
                                    "transition-all duration-200"
                                )}
                            >
                                <Save className="w-4 h-4 mr-2" />
                                Save Changes
                            </Button>
                        </div>
                    )}
                </div>
            </AlertDialogContent>
        </AlertDialog>
    );
};
