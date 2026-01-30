import React, { useCallback, useEffect, useMemo, useState, useContext } from "react";
import { FrappeConfig, FrappeContext, useFrappeCreateDoc, useFrappeFileUpload, useFrappeGetDocList, useFrappeDocTypeEventListener } from "frappe-react-sdk";
import memoize from 'lodash/memoize';
import { AlertCircle, ArrowDownToLine, Building2, Calendar, CreditCard, FileText, Hash, IndianRupee } from "lucide-react";
import { TailSpin } from "react-loader-spinner";

// --- UI Components ---
import ProjectSelect from "@/components/custom-select/project-select";
import { CustomAttachment } from "@/components/helpers/CustomAttachment";
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

// --- Types ---
import { ProjectInflows as ProjectInflowsType } from "@/types/NirmaanStack/ProjectInflows"; // Alias for clarity
import { Projects } from "@/types/NirmaanStack/Projects";
import { Customers } from "@/types/NirmaanStack/Customers";

// --- Utils & State ---
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { getTotalInflowAmount } from "@/utils/getAmounts";
import { parseNumber } from "@/utils/parseNumber";
import { useDialogStore } from "@/zustand/useDialogStore";
import { getProjectListOptions, queryKeys } from "@/config/queryKeys";
import { formatDate } from "date-fns";
import { cn } from "@/lib/utils";

// Interface for the form state
interface NewInflowFormState {
    project: string;
    customer: string;
    project_name?: string;
    customer_name?: string;
    amount: string;
    payment_date: string; // YYYY-MM-DD
    utr: string;
    // Add other fields from ProjectInflows that are part of the form
}

const INITIAL_FORM_STATE: NewInflowFormState = {
    project: "",
    customer: "",
    project_name: "",
    customer_name: "",
    amount: "",
    payment_date: formatDate(new Date(), "yyyy-MM-dd"), // Default to today
    utr: "",
};

interface NewInflowPaymentProps {
    refetch?: () => void; // Optional refetch function
}

// --- Component ---
export const NewInflowPayment: React.FC<NewInflowPaymentProps> = ({ refetch }) => {
    const { newInflowDialog, toggleNewInflowDialog } = useDialogStore();
    const { toast } = useToast();


    const [formState, setFormState] = useState<NewInflowFormState>(INITIAL_FORM_STATE);
    const [paymentScreenshot, setPaymentScreenshot] = useState<File | null>(null);
    const [isProjectValidForPayment, setIsProjectValidForPayment] = useState(false); // Project has a customer
    const [formErrors, setFormErrors] = useState<Partial<Record<keyof NewInflowFormState, string>>>({});

    // --- Data Mutators ---
    const { createDoc, loading: createLoading } = useFrappeCreateDoc();
    const { upload, loading: uploadLoading } = useFrappeFileUpload();

    // --- Supporting Data Fetches ---
    // Fetch all projects for selection, and customers for display mapping
    const projectsFetchOptions = getProjectListOptions({ fields: ["name", "project_name", "customer"] });
    const projectQueryKey = queryKeys.projects.list(projectsFetchOptions);
    const { data: projects, isLoading: projectsLoading } = useFrappeGetDocList<Projects>(
        "Projects", projectsFetchOptions as any, projectQueryKey
    );

    const customersFetchOptions = { fields: ["name", "company_name"], limit: 10000 }; // Fetch many customers
    const customerQueryKey = queryKeys.customers.list(customersFetchOptions);
    const { data: customers, isLoading: customersLoading } = useFrappeGetDocList<Customers>(
        "Customers", customersFetchOptions as any, customerQueryKey
    );

    // Fetch existing inflows to calculate 'Total Amount Received' for a project
    const { data: projectInflows, isLoading: projectInflowsLoading, mutate: projectInflowsMutate } = useFrappeGetDocList<ProjectInflowsType>(
        "Project Inflows", { fields: ["project", "amount"], limit: 100000 }, // Fetch all, only needed fields
        "AllProjectInflowsForValidation" // Specific key for SWR
    );

    // --- Event Listener for Realtime Updates ---
    useFrappeDocTypeEventListener("Project Inflows", (event) => {
        console.log("Project Inflows event received in NewInflowPayment:", event);
        projectInflowsMutate(); // Revalidate SWR cache for projectInflows
    });

    // --- Derived State & Memoized Callbacks ---
    const getAmountReceivedForProject = useMemo(() => memoize((projectId: string): number => {
        if (!projectInflows || !projectId) return 0;
        const filtered = projectInflows.filter(p => p.project === projectId);
        return getTotalInflowAmount(filtered); // Assumes getTotalInflowAmount works with ProjectInflowsType[]
    }), [projectInflows]);

    const handleProjectChange = useCallback((selectedOption: { value: string; label: string } | null) => {
        if (selectedOption) {
            const project = projects?.find(p => p.name === selectedOption.value);
            const customerId = project?.customer || "";
            const customerName = customers?.find(c => c.name === customerId)?.company_name || (customerId ? "Customer not found" : "No Customer");

            setFormState(prev => ({
                ...INITIAL_FORM_STATE, // Reset other fields but keep new project
                payment_date: prev.payment_date || formatDate(new Date(), "yyyy-MM-dd"), // Preserve date if already set
                project: selectedOption.value,
                project_name: selectedOption.label,
                customer: customerId,
                customer_name: customerName
            }));
            setIsProjectValidForPayment(!!customerId);
            if (!customerId) {
                toast({ title: "Warning", description: "Selected project does not have an associated customer. Payment cannot be recorded.", variant: "destructive" });
            }
        } else {
            setFormState(INITIAL_FORM_STATE);
            setIsProjectValidForPayment(false);
        }
        setFormErrors({}); // Clear errors on project change
    }, [projects, customers, toast]);

    const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setFormState(prev => ({ ...prev, [name]: value }));
        if (formErrors[name as keyof NewInflowFormState]) {
            setFormErrors(prev => ({...prev, [name]: undefined })); // Clear error on change
        }
    }, [formErrors]);

    const validateForm = useCallback((): boolean => {
        const errors: Partial<Record<keyof NewInflowFormState, string>> = {};
        if (!formState.project) errors.project = "Project is required.";
        if (!isProjectValidForPayment) errors.project = "Selected project must have an associated customer.";
        if (!formState.amount || parseNumber(formState.amount) <= 0) errors.amount = "Valid amount is required.";
        if (!formState.utr.trim()) errors.utr = "Payment Reference (UTR) is required.";
        if (!formState.payment_date) errors.payment_date = "Payment date is required.";
        // Add more validations as needed

        setFormErrors(errors);
        return Object.keys(errors).length === 0;
    }, [formState, isProjectValidForPayment]);


    const handleSubmitPayment = useCallback(async () => {
        if (!validateForm()) {
            toast({ title: "Validation Error", description: "Please correct the errors in the form.", variant: "destructive" });
            return;
        }

        let fileUrl: string | undefined = undefined;
        try {
            if (paymentScreenshot) {
                // Frappe requires a temporary docname if the main doc isn't created yet for file attachment.
                // Using a placeholder; the file will be re-linked upon successful doc creation if needed,
                // or a better approach is to create doc first, then attach.
                // For simplicity with createDoc, we'll create, then update with file URL if needed.
                const tempDocName = `temp-inflow-${Date.now()}`; // Temporary name
                const fileArgs = {
                    doctype: "Project Inflows", // Target doctype
                    docname: tempDocName,      // Temporary name, file is public by default
                    fieldname: "inflow_attachment", // Field to attach to
                    // file: paymentScreenshot,
                    isPrivate: true, // Make it private
                };
                const uploadedFile = await upload(paymentScreenshot, fileArgs);
                fileUrl = uploadedFile.file_url;
            }

            const docToCreate: Partial<ProjectInflowsType> = {
                project: formState.project,
                customer: formState.customer,
                amount: parseNumber(formState.amount),
                payment_date: formState.payment_date,
                utr: formState.utr.trim(),
                inflow_attachment: fileUrl, // Will be undefined if no screenshot
            };

            await createDoc("Project Inflows", docToCreate);
            // If file was uploaded to a temp name, and if Frappe < v15 doesn't auto-relink,
            // you might need a setValue call here to update the attachment on the *actual* newDoc.name.
            // However, with frappe-react-sdk v0.0.9+ and Frappe v14/15+, `file_url` is usually sufficient.

            toast({ title: "Success!", description: "Inflow payment added successfully!", variant: "success" });
            projectInflowsMutate(); // Revalidate the list of inflows
            refetch?.();
            closeDialogAndReset();
        } catch (error: any) {
            console.error("Error adding inflow payment:", error);
            toast({ title: "Failed!", description: error.message || "Failed to add payment.", variant: "destructive" });
        }
    }, [createDoc, formState, paymentScreenshot, toggleNewInflowDialog, projectInflowsMutate, upload, validateForm, toast]);

    const closeDialogAndReset = () => {
        setFormState(INITIAL_FORM_STATE);
        setPaymentScreenshot(null);
        setFormErrors({});
        toggleNewInflowDialog(); // From Zustand store
    };

    // Effect to reset form when dialog opens/closes (if newInflowDialog state changes externally)
    useEffect(() => {
        if (newInflowDialog) {
            setFormState(INITIAL_FORM_STATE); // Reset form when dialog is to be shown
            setPaymentScreenshot(null);
            setFormErrors({});
            setIsProjectValidForPayment(false); // Reset validation
        }
    }, [newInflowDialog]);


    const isSubmitDisabled = !formState.project || !formState.amount || !formState.utr || !formState.payment_date || !isProjectValidForPayment || Object.keys(formErrors).length > 0;
    const isLoadingAny = createLoading || uploadLoading || projectsLoading || customersLoading || projectInflowsLoading;

    return (
        <AlertDialog open={newInflowDialog} onOpenChange={closeDialogAndReset}>
            <AlertDialogContent className="max-w-[480px] p-0 gap-0 overflow-hidden border-0 shadow-2xl">
                {/* Header */}
                <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 px-6 py-5">
                    <div className="flex items-center gap-3">
                        <div className="flex items-center justify-center w-10 h-10 rounded-full bg-emerald-500/20 ring-1 ring-emerald-500/30">
                            <ArrowDownToLine className="w-5 h-5 text-emerald-400" />
                        </div>
                        <div>
                            <AlertDialogTitle className="text-lg font-semibold text-white tracking-tight">
                                Record Inflow Payment
                            </AlertDialogTitle>
                            <p className="text-xs text-slate-400 mt-0.5">
                                Add a new payment received from customer
                            </p>
                        </div>
                    </div>
                </div>

                {/* Body */}
                <div className="px-6 py-5 space-y-5 bg-white dark:bg-slate-950">
                    {/* Project Context Section */}
                    <div className="space-y-4">
                        <div className="flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                            <Building2 className="w-3.5 h-3.5" />
                            Project Context
                        </div>

                        {/* Project Select */}
                        <div className="space-y-1.5">
                            <Label htmlFor="project" className="text-sm font-medium text-slate-700 dark:text-slate-300">
                                Select Project <span className="text-red-500">*</span>
                            </Label>
                            <ProjectSelect
                                all={true}
                                onChange={handleProjectChange}
                                universal={false}
                                usePortal
                            />
                            {formErrors.project && (
                                <p className="text-xs text-red-500 flex items-center gap-1 mt-1">
                                    <AlertCircle className="w-3 h-3" />
                                    {formErrors.project}
                                </p>
                            )}
                        </div>

                        {/* Customer & Total Received - Side by side badges */}
                        {formState.project && (
                            <div className="grid grid-cols-2 gap-3">
                                <div className={cn(
                                    "rounded-lg px-3 py-2.5 border transition-colors",
                                    isProjectValidForPayment
                                        ? "bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800"
                                        : "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800"
                                )}>
                                    <p className="text-[10px] font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-0.5">
                                        Customer
                                    </p>
                                    <p className={cn(
                                        "text-sm font-medium truncate",
                                        isProjectValidForPayment
                                            ? "text-slate-900 dark:text-slate-100"
                                            : "text-amber-700 dark:text-amber-400"
                                    )}>
                                        {formState.customer_name || "No Customer"}
                                    </p>
                                </div>
                                <div className="rounded-lg px-3 py-2.5 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800">
                                    <p className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400 uppercase tracking-wider mb-0.5">
                                        Total Received
                                    </p>
                                    <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">
                                        {formatToRoundedIndianRupee(getAmountReceivedForProject(formState.project))}
                                    </p>
                                </div>
                            </div>
                        )}

                        {/* Warning Alert */}
                        {formState.project && !isProjectValidForPayment && (
                            <Alert className="bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800 py-3">
                                <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                                <AlertDescription className="text-amber-700 dark:text-amber-300 text-xs leading-relaxed">
                                    This project has no customer assigned. Please update the project details before recording payments.
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
                    <div className={cn(
                        "space-y-4 transition-opacity",
                        !isProjectValidForPayment && "opacity-50 pointer-events-none"
                    )}>
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
                                    disabled={!isProjectValidForPayment}
                                    className={cn(
                                        "pl-7 h-10 text-base font-medium transition-all",
                                        "focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500",
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
                                    disabled={!isProjectValidForPayment}
                                    className={cn(
                                        "h-10 transition-all",
                                        "focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500",
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
                                    disabled={!isProjectValidForPayment}
                                    max={formatDate(new Date(), "yyyy-MM-dd")}
                                    className={cn(
                                        "h-10 transition-all",
                                        "focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500",
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

                        {/* Attachment */}
                        <div className="space-y-1.5">
                            <Label className="text-sm font-medium text-slate-700 dark:text-slate-300 flex items-center gap-2">
                                <FileText className="w-3.5 h-3.5 text-slate-400" />
                                Payment Proof
                                <span className="text-xs font-normal text-slate-400">(Optional)</span>
                            </Label>
                            <CustomAttachment
                                selectedFile={paymentScreenshot}
                                onFileSelect={setPaymentScreenshot}
                                disabled={!isProjectValidForPayment}
                                maxFileSize={5 * 1024 * 1024}
                            />
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="px-6 py-4 bg-slate-50 dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800">
                    {isLoadingAny ? (
                        <div className="flex items-center justify-center gap-3 py-1">
                            <TailSpin color="#10b981" height={24} width={24} />
                            <span className="text-sm text-slate-500">Processing...</span>
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
                                    "bg-emerald-600 hover:bg-emerald-700 text-white",
                                    "shadow-sm shadow-emerald-600/20",
                                    "disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none",
                                    "transition-all duration-200"
                                )}
                            >
                                <CreditCard className="w-4 h-4 mr-2" />
                                Record Payment
                            </Button>
                        </div>
                    )}
                </div>
            </AlertDialogContent>
        </AlertDialog>
    );
};
