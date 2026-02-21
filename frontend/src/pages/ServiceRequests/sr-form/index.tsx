import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams, useBlocker } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useFrappeCreateDoc } from "frappe-react-sdk";
import { ChevronLeft, ChevronRight, Send, Loader2, CheckCircle2, X } from "lucide-react";

// UI Components
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { WizardSteps } from "@/components/ui/wizard-steps";
import { FormResetWarningDialog } from "@/components/ui/form-reset-warning-dialog";
import { toast } from "@/components/ui/use-toast";
import {
    AlertDialog,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// Hooks & Utils
import { useUserData } from "@/hooks/useUserData";
import { useCEOHoldGuard } from "@/hooks/useCEOHoldGuard";
import { CEOHoldBanner } from "@/components/ui/ceo-hold-banner";
import { useSRFormData } from "./hooks/useSRFormData";

// Schema & Constants
import {
    srFormSchema,
    SRFormValues,
    defaultSRFormValues,
    validateStep1,
    validateStep2,
    ValidationResult,
} from "./schema";
import {
    SR_WIZARD_STEPS,
    SR_SECTIONS,
    SRSectionKey,
    getSectionByIndex,
    isFirstStep,
    isLastStep,
    SR_SECTION_TITLES,
    SR_SECTION_DESCRIPTIONS,
} from "./constants";

// Step Components
import { ServiceItemsStep, VendorRatesStep, ReviewStep } from "./steps";

/* ─────────────────────────────────────────────────────────────
   CREATION DIALOG STAGES
   ───────────────────────────────────────────────────────────── */
type CreationStage = "idle" | "creating-sr" | "adding-comment" | "complete" | "error";

interface CreationState {
    stage: CreationStage;
    srName?: string;
    error?: string;
}

/* ─────────────────────────────────────────────────────────────
   HELPER: Check if form has meaningful data
   ───────────────────────────────────────────────────────────── */
const hasFormData = (values: SRFormValues): boolean => {
    return (values.items?.length > 0) || !!values.vendor;
};

/* ─────────────────────────────────────────────────────────────
   MAIN COMPONENT
   ───────────────────────────────────────────────────────────── */
export const SRFormWizard = () => {
    const navigate = useNavigate();
    const { projectId } = useParams<{ projectId: string }>();
    const userData = useUserData();

    /* ─────────────────────────────────────────────────────────
       STATE
       ───────────────────────────────────────────────────────── */
    const [currentStep, setCurrentStep] = useState(0);
    const [creationState, setCreationState] = useState<CreationState>({ stage: "idle" });
    const [showCreationDialog, setShowCreationDialog] = useState(false);
    const [showExitWarning, setShowExitWarning] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);

    /* ─────────────────────────────────────────────────────────
       FORM SETUP
       ───────────────────────────────────────────────────────── */
    const form = useForm<SRFormValues>({
        resolver: zodResolver(srFormSchema),
        defaultValues: {
            ...defaultSRFormValues,
            project: projectId ? { id: projectId, name: "" } : defaultSRFormValues.project,
        },
        mode: "onChange",
    });

    const { setValue, trigger, getValues } = form;

    /* ─────────────────────────────────────────────────────────
       CEO HOLD GUARD
       ───────────────────────────────────────────────────────── */
    const { isCEOHold, showBlockedToast } = useCEOHoldGuard(projectId);

    /* ─────────────────────────────────────────────────────────
       DATA FETCHING
       ───────────────────────────────────────────────────────── */
    const {
        categories,
        vendors,
        project,
        autoSelectedGST,
        isLoading: dataLoading,
    } = useSRFormData(projectId);

    /* ─────────────────────────────────────────────────────────
       NAVIGATION BLOCKER
       Block browser back/forward when form has data
       ───────────────────────────────────────────────────────── */
    const blocker = useBlocker(
        ({ currentLocation, nextLocation }) =>
            !isSubmitting &&
            currentLocation.pathname !== nextLocation.pathname &&
            hasFormData(getValues())
    );

    // Sync blocker state with dialog
    useEffect(() => {
        if (blocker.state === "blocked") {
            setShowExitWarning(true);
        }
    }, [blocker.state]);

    /* ─────────────────────────────────────────────────────────
       FRAPPE API
       ───────────────────────────────────────────────────────── */
    const { createDoc, loading: createLoading } = useFrappeCreateDoc();

    /* ─────────────────────────────────────────────────────────
       SYNC PROJECT DATA WHEN LOADED
       ───────────────────────────────────────────────────────── */
    useEffect(() => {
        if (project && projectId) {
            setValue("project", {
                id: project.name,
                name: project.project_name,
            });

            // Auto-set GST if single option
            const currentGst = getValues("project_gst");
            if (autoSelectedGST && !currentGst) {
                setValue("project_gst", autoSelectedGST);
            }
        }
    }, [project, projectId, autoSelectedGST, setValue, getValues]);

    /* ─────────────────────────────────────────────────────────
       EXIT WARNING HANDLERS
       ───────────────────────────────────────────────────────── */
    const handleCancelClick = useCallback(() => {
        // If form has no data, navigate directly without warning
        if (!hasFormData(getValues())) {
            navigate("/service-requests");
            return;
        }
        setShowExitWarning(true);
    }, [getValues, navigate]);

    const handleDiscard = useCallback(() => {
        setShowExitWarning(false);
        if (blocker.state === "blocked") {
            blocker.proceed(); // Allow blocked navigation
        } else {
            navigate("/service-requests"); // Manual navigation
        }
    }, [blocker, navigate]);

    const handleContinueEditing = useCallback(() => {
        setShowExitWarning(false);
        if (blocker.state === "blocked") {
            blocker.reset(); // Cancel blocked navigation
        }
    }, [blocker]);

    /* ─────────────────────────────────────────────────────────
       STEP VALIDATION
       ───────────────────────────────────────────────────────── */
    const validateCurrentStep = useCallback(async (): Promise<ValidationResult> => {
        const currentSection = getSectionByIndex(currentStep);
        const currentFormValues = getValues();

        switch (currentSection) {
            case "items":
                return validateStep1(currentFormValues);
            case "vendor":
                return validateStep2(currentFormValues);
            case "review":
                // Full validation on review step
                const result = srFormSchema.safeParse(currentFormValues);
                if (!result.success) {
                    return {
                        success: false,
                        error: result.error.errors[0]?.message || "Please review all details.",
                    };
                }
                return { success: true };
            default:
                return { success: true };
        }
    }, [currentStep, getValues]);

    /* ─────────────────────────────────────────────────────────
       NAVIGATION HANDLERS
       ───────────────────────────────────────────────────────── */
    const handleNext = useCallback(async () => {
        const validationResult = await validateCurrentStep();

        if (!validationResult.success) {
            // Trigger form validation to show inline errors
            await trigger();
            toast({
                title: "Validation Error",
                description: validationResult.error || "Please complete all required fields before proceeding.",
                variant: "destructive",
            });
            return;
        }

        if (currentStep < SR_SECTIONS.length - 1) {
            setCurrentStep((prev) => prev + 1);
        }
    }, [currentStep, validateCurrentStep, trigger, toast]);

    const handlePrevious = useCallback(() => {
        if (currentStep > 0) {
            setCurrentStep((prev) => prev - 1);
        }
    }, [currentStep]);

    const handleStepClick = useCallback(
        async (stepIndex: number) => {
            // Only allow going back or to current step without validation
            if (stepIndex <= currentStep) {
                setCurrentStep(stepIndex);
            } else {
                // Validate before moving forward
                const isValid = await validateCurrentStep();
                if (isValid && stepIndex === currentStep + 1) {
                    setCurrentStep(stepIndex);
                }
            }
        },
        [currentStep, validateCurrentStep]
    );

    /* ─────────────────────────────────────────────────────────
       SR SUBMISSION
       ───────────────────────────────────────────────────────── */
    const handleSubmit = useCallback(async () => {
        // CEO Hold guard
        if (isCEOHold) {
            showBlockedToast();
            return;
        }

        // Get current form values
        const currentFormValues = getValues();

        // Final validation
        const validation = srFormSchema.safeParse(currentFormValues);
        if (!validation.success) {
            toast({
                title: "Validation Error",
                description: "Please ensure all required fields are filled.",
                variant: "destructive",
            });
            return;
        }

        setIsSubmitting(true);
        setShowCreationDialog(true);
        setCreationState({ stage: "creating-sr" });

        try {
            // Build service_order_list structure
            const serviceOrderList = {
                list: currentFormValues.items.map((item) => ({
                    id: item.id,
                    category: item.category,
                    description: item.description,
                    uom: item.uom,
                    quantity: item.quantity,
                    rate: item.rate || 0,
                })),
            };

            // Build service_category_list from unique categories
            const uniqueCategories = [...new Set(currentFormValues.items.map((item) => item.category))];
            const serviceCategoryList = {
                list: uniqueCategories.map((name) => ({ name })),
            };

            // Create Service Request document with "Vendor Selected" status
            const srDoc = await createDoc("Service Requests", {
                project: currentFormValues.project.id,
                vendor: currentFormValues.vendor?.id,
                service_order_list: serviceOrderList,
                service_category_list: serviceCategoryList,
                status: "Vendor Selected",
                project_gst: currentFormValues.project_gst || undefined,
            });

            const srName = srDoc?.name;
            setCreationState({ stage: "adding-comment", srName });

            // Add comment if provided
            if (currentFormValues.comments) {
                try {
                    await createDoc("Nirmaan Comments", {
                        comment_type: "Comment",
                        reference_doctype: "Service Requests",
                        reference_name: srName,
                        comment_by: userData?.user_id,
                        content: currentFormValues.comments,
                        subject: "creating sr via wizard",
                    });
                } catch (commentError) {
                    console.warn("Failed to add comment:", commentError);
                    // Don't fail the whole operation for comment failure
                }
            }

            // Success
            setCreationState({ stage: "complete", srName });

            toast({
                title: "Success!",
                description: `Work Order ${srName} created successfully!`,
                variant: "success",
            });

            // Navigate to service requests list after a short delay
            setTimeout(() => {
                navigate("/service-requests");
            }, 1500);

        } catch (error: any) {
            console.error("SR creation error:", error);
            setIsSubmitting(false);
            setCreationState({
                stage: "error",
                error: error?.message || "Failed to create Work Order",
            });

            toast({
                title: "Failed!",
                description: error?.message || "Failed to create Work Order",
                variant: "destructive",
            });
        }
    }, [getValues, createDoc, userData?.user_id, navigate, isCEOHold, showBlockedToast]);

    /* ─────────────────────────────────────────────────────────
       RENDER CURRENT STEP
       ─────────────────────────────────────────────────────────
       NOTE: We intentionally avoid useMemo here because:
       1. The `form` object reference is stable (doesn't change when values update)
       2. useMemo would cache JSX elements, preventing re-renders when form values change
       3. This caused the bug where vendor selection and rate inputs weren't updating in real-time
       Creating JSX elements is cheap - React's diffing handles updates efficiently.
       ───────────────────────────────────────────────────────── */
    const renderCurrentStep = () => {
        const currentSection = getSectionByIndex(currentStep);

        switch (currentSection) {
            case "items":
                return (
                    <ServiceItemsStep
                        form={form}
                        categories={categories}
                        isLoading={dataLoading}
                    />
                );
            case "vendor":
                return (
                    <VendorRatesStep
                        form={form}
                        vendors={vendors}
                        isLoading={dataLoading}
                    />
                );
            case "review":
                return (
                    <ReviewStep
                        form={form}
                    />
                );
            default:
                return null;
        }
    };

    /* ─────────────────────────────────────────────────────────
       CURRENT SECTION INFO
       ───────────────────────────────────────────────────────── */
    const currentSection = getSectionByIndex(currentStep) as SRSectionKey;
    const sectionTitle = SR_SECTION_TITLES[currentSection];
    const sectionDescription = SR_SECTION_DESCRIPTIONS[currentSection];

    /* ─────────────────────────────────────────────────────────
       LOADING STATE
       ───────────────────────────────────────────────────────── */
    if (dataLoading) {
        return (
            <div className="flex items-center justify-center h-[60vh]">
                <div className="flex flex-col items-center gap-4">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    <p className="text-muted-foreground">Loading form data...</p>
                </div>
            </div>
        );
    }

    /* ─────────────────────────────────────────────────────────
       MAIN RENDER
       ───────────────────────────────────────────────────────── */
    return (
        <div className="flex-1 space-y-4">
            {/* Form Reset Warning Dialog */}
            <FormResetWarningDialog
                open={showExitWarning}
                onOpenChange={setShowExitWarning}
                onDiscard={handleDiscard}
                onContinue={handleContinueEditing}
            />

            {/* Creation Progress Dialog */}
            <AlertDialog open={showCreationDialog} onOpenChange={setShowCreationDialog}>
                <AlertDialogContent className="sm:max-w-md">
                    <AlertDialogHeader>
                        <AlertDialogTitle className="text-center">
                            {creationState.stage === "error"
                                ? "Creation Failed"
                                : creationState.stage === "complete"
                                    ? "Work Order Created!"
                                    : "Creating Work Order..."}
                        </AlertDialogTitle>
                        <AlertDialogDescription asChild>
                            <div className="space-y-4 pt-4">
                                {/* Stage: Creating SR */}
                                <div className="flex items-center gap-3">
                                    {creationState.stage === "creating-sr" ? (
                                        <Loader2 className="h-5 w-5 animate-spin text-primary" />
                                    ) : creationState.stage === "error" ? (
                                        <div className="h-5 w-5 rounded-full bg-destructive/20 flex items-center justify-center">
                                            <span className="text-destructive text-xs">!</span>
                                        </div>
                                    ) : (
                                        <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                                    )}
                                    <span
                                        className={
                                            creationState.stage === "creating-sr"
                                                ? "text-foreground font-medium"
                                                : "text-muted-foreground"
                                        }
                                    >
                                        Creating Work Order document
                                    </span>
                                </div>

                                {/* Stage: Adding Comment */}
                                <div className="flex items-center gap-3">
                                    {creationState.stage === "adding-comment" ? (
                                        <Loader2 className="h-5 w-5 animate-spin text-primary" />
                                    ) : ["complete"].includes(creationState.stage) ? (
                                        <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                                    ) : (
                                        <div className="h-5 w-5 rounded-full bg-muted" />
                                    )}
                                    <span
                                        className={
                                            creationState.stage === "adding-comment"
                                                ? "text-foreground font-medium"
                                                : "text-muted-foreground"
                                        }
                                    >
                                        Adding comments
                                    </span>
                                </div>

                                {/* Error Message */}
                                {creationState.stage === "error" && creationState.error && (
                                    <div className="mt-4 p-3 bg-destructive/10 rounded-lg border border-destructive/20">
                                        <p className="text-sm text-destructive">{creationState.error}</p>
                                    </div>
                                )}

                                {/* Success Message */}
                                {creationState.stage === "complete" && creationState.srName && (
                                    <div className="mt-4 p-3 bg-emerald-50 dark:bg-emerald-950/30 rounded-lg border border-emerald-200 dark:border-emerald-800">
                                        <p className="text-sm text-emerald-700 dark:text-emerald-400">
                                            Work Order <strong>{creationState.srName}</strong> has been created
                                            and sent for approval.
                                        </p>
                                    </div>
                                )}

                                {/* Close Button for Error State */}
                                {creationState.stage === "error" && (
                                    <Button
                                        variant="outline"
                                        className="w-full mt-4"
                                        onClick={() => {
                                            setShowCreationDialog(false);
                                            setCreationState({ stage: "idle" });
                                        }}
                                    >
                                        Close
                                    </Button>
                                )}
                            </div>
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                </AlertDialogContent>
            </AlertDialog>

            {/* Header with Cancel button */}
            <div className="flex items-center justify-between py-2">
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleCancelClick}
                    className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground -ml-2"
                >
                    <X className="h-4 w-4" />
                    <span className="hidden sm:inline">Cancel</span>
                </Button>
            </div>

            {/* Title below header */}
            <div className="px-4 sm:px-0">
                <h1 className="text-xl font-semibold tracking-tight">New Work Order</h1>
                {project && (
                    <p className="text-sm text-muted-foreground">{project.project_name}</p>
                )}
            </div>

            {/* CEO Hold Banner */}
            {isCEOHold && <CEOHoldBanner className="mb-4" />}

            {/* Wizard Steps Progress */}
            <Card className="border-0 shadow-sm bg-card/50">
                <CardContent className="p-0">
                    <WizardSteps
                        steps={SR_WIZARD_STEPS}
                        currentStep={currentStep}
                        onStepClick={handleStepClick}
                    />
                </CardContent>
            </Card>

            {/* Step Content */}
            <Card className="shadow-sm">
                <CardContent className="p-6">
                    {/* Step Header */}
                    <div className="mb-6">
                        <h2 className="text-lg font-semibold">{sectionTitle}</h2>
                        <p className="text-sm text-muted-foreground">{sectionDescription}</p>
                    </div>

                    {/* Step Component */}
                    {renderCurrentStep()}
                </CardContent>
            </Card>

            {/* Navigation Buttons */}
            <div className="flex items-center justify-between px-4 sm:px-0 pb-4">
                <Button
                    variant="outline"
                    onClick={handlePrevious}
                    disabled={isFirstStep(currentSection)}
                    className="gap-2"
                >
                    <ChevronLeft className="h-4 w-4" />
                    Previous
                </Button>

                {isLastStep(currentSection) ? (
                    <Button
                        onClick={handleSubmit}
                        disabled={createLoading}
                        className="gap-2"
                    >
                        {createLoading ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                            <Send className="h-4 w-4" />
                        )}
                        Send for Approval
                    </Button>
                ) : (
                    <Button onClick={handleNext} className="gap-2">
                        Next
                        <ChevronRight className="h-4 w-4" />
                    </Button>
                )}
            </div>
        </div>
    );
};

export const Component = SRFormWizard;
export default SRFormWizard;
