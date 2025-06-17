import React, { useCallback, useEffect, useMemo, useState, useContext } from "react";
import { FrappeConfig, FrappeContext, useFrappeCreateDoc, useFrappeFileUpload, useFrappeGetDocList, useFrappeDocTypeEventListener } from "frappe-react-sdk";
import memoize from 'lodash/memoize';
import { TailSpin } from "react-loader-spinner";

// --- UI Components ---
import ProjectSelect from "@/components/custom-select/project-select";
import { CustomAttachment } from "@/components/helpers/CustomAttachment";
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
            <AlertDialogContent className="max-w-lg">
                <AlertDialogHeader>
                    <AlertDialogTitle data-cy="add-new-inflow-dialog-text" className="text-center text-xl">Record New Inflow Payment</AlertDialogTitle>
                    <Separator className="my-4" />
                </AlertDialogHeader>
                <div className="space-y-4 py-2">
                    <div className="grid grid-cols-3 items-center gap-4">
                        <Label htmlFor="project" className="text-right">Project <sup className="text-destructive">*</sup></Label>
                        <div data-cy="add-new-inflow-dropdown" className="col-span-2">
                            <ProjectSelect
                                all={true} // Assuming this means fetch all projects
                                // value={formState.project ? { value: formState.project, label: formState.project_name || formState.project } : null}
                                onChange={handleProjectChange}
                                // options={projects?.map(p => ({value: p.name, label: p.project_name}))}
                                // isLoading={projectsLoading}
                                universal={false} // What does this do?
                                // className="h-9"
                            />
                             {formErrors.project && <p className="text-xs text-destructive mt-1">{formErrors.project}</p>}
                        </div>
                    </div>

                    <div className="grid grid-cols-3 items-center gap-4">
                        <Label htmlFor="customer" className="text-right">Customer</Label>
                        <Input data-cy="add-new-inflow-customer-input" id="customer" value={formState.customer_name || (formState.project && !isProjectValidForPayment ? "No Customer Linked" : "--")} disabled className="col-span-2 h-9 bg-muted/50" />
                    </div>

                    <div className="grid grid-cols-3 items-center gap-4">
                        <Label htmlFor="totalReceived" className="text-right">Total Received (Project)</Label>
                        <Input data-cy="add-new-inflow-total-received-input" id="totalReceived" value={formState.project ? formatToRoundedIndianRupee(getAmountReceivedForProject(formState.project)) : "--"} disabled className="col_span-2 h-9 bg-muted/50" />
                    </div>

                    <Separator className="my-4" />

                    <div className="grid grid-cols-3 items-center gap-4">
                        <Label htmlFor="amount" className="text-right">Amount <sup className="text-destructive">*</sup></Label>
                        <Input data-cy="add-new-inflow-amount-input" id="amount" name="amount" type="number" placeholder="Enter Amount" value={formState.amount} onChange={handleInputChange} disabled={!isProjectValidForPayment} className="col-span-2 h-9" />
                        {formErrors.amount && <p className="col-span-3 col-start-2 text-xs text-destructive mt-1">{formErrors.amount}</p>}
                    </div>

                    <div className="grid grid-cols-3 items-center gap-4">
                        <Label htmlFor="utr" className="text-right">Payment Ref (UTR) <sup className="text-destructive">*</sup></Label>
                        <Input data-cy="add-new-inflow-payment-ref-input" id="utr" name="utr" type="text" placeholder="Enter UTR/Ref No." value={formState.utr} onChange={handleInputChange} disabled={!isProjectValidForPayment} className="col-span-2 h-9" />
                         {formErrors.utr && <p className="col-span-3 col-start-2 text-xs text-destructive mt-1">{formErrors.utr}</p>}
                    </div>

                    <div className="grid grid-cols-3 items-center gap-4">
                        <Label htmlFor="payment_date" className="text-right">Payment Date <sup className="text-destructive">*</sup></Label>
                        <Input id="payment_date" name="payment_date" type="date" value={formState.payment_date} onChange={handleInputChange} disabled={!isProjectValidForPayment} max={formatDate(new Date(), "yyyy-MM-dd")} className="col-span-2 h-9" />
                        {formErrors.payment_date && <p className="col-span-3 col-start-2 text-xs text-destructive mt-1">{formErrors.payment_date}</p>}
                    </div>

                    <CustomAttachment
                        label="Payment Proof (Optional)"
                        selectedFile={paymentScreenshot}
                        onFileSelect={setPaymentScreenshot}
                        disabled={!isProjectValidForPayment}
                        maxFileSize={5 * 1024 * 1024} // 5MB
                    />
                </div>
                <AlertDialogFooter className="pt-6">
                    {(createLoading || uploadLoading || isLoadingAny /* general loading for data */) ? (
                        <div className="flex justify-center w-full"><TailSpin color="#ef4444" height={28} width={28} /></div>
                    ) : (
                        <>
                            <AlertDialogCancel data-cy="new-inflow-cancel-button">Cancel</AlertDialogCancel>
                            <Button data-cy="new-inflow-add-payment-button" onClick={handleSubmitPayment} disabled={isSubmitDisabled}>Add Payment</Button>
                        </>
                    )}
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
};