import { useCallback, useEffect, useState } from "react";
import { useForm, UseFormReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useFrappeUpdateDoc, useFrappeCreateDoc } from "frappe-react-sdk";
import { useUserData } from "@/hooks/useUserData";
import { toast } from "@/components/ui/use-toast";

import {
    srFormSchema,
    SRFormValues,
    validateStep1,
    validateStep2,
    ValidationResult,
} from "../schema";
import {
    SR_SECTIONS,
    SRSectionKey,
    getSectionByIndex,
    SR_SECTION_TITLES,
    SR_SECTION_DESCRIPTIONS,
    isFirstStep as checkIsFirstStep,
    isLastStep as checkIsLastStep,
} from "../constants";
import { transformFormValuesToSRPayload } from "./transformers";

/* ─────────────────────────────────────────────────────────────
   TYPES
   ───────────────────────────────────────────────────────────── */

export type SubmissionStage =
    | "idle"
    | "updating-sr"
    | "adding-comment"
    | "complete"
    | "error";

export interface SubmissionState {
    stage: SubmissionStage;
    srName?: string;
    error?: string;
}

export interface UseSRAmendFormProps {
    /** Initial form values loaded from the SR document */
    initialFormValues: SRFormValues | undefined;
    /** The SR document name being amended */
    srName: string;
    /** Determines the status after submission:
     * - "rejected": Sets status to "Vendor Selected" (for rejected WO edit flow)
     * - "approved": Sets status to "Amendment" (for approved WO amend flow)
     */
    mode: "rejected" | "approved";
    /** Callback after successful submission */
    onSuccess?: (updatedSrName: string) => void;
}

export interface UseSRAmendFormReturn {
    /** React Hook Form instance */
    form: UseFormReturn<SRFormValues>;
    /** Current step index (0-based) */
    currentStep: number;
    /** Current section key */
    currentSection: SRSectionKey;
    /** Title for the current section */
    sectionTitle: string;
    /** Description for the current section */
    sectionDescription: string;

    // Navigation
    /** Move to next step (validates current step first) */
    handleNext: () => Promise<void>;
    /** Move to previous step */
    handlePrevious: () => void;
    /** Navigate to a specific step (validates if moving forward) */
    handleStepClick: (stepIndex: number) => Promise<void>;
    /** Whether currently on first step */
    isFirstStep: boolean;
    /** Whether currently on last step */
    isLastStep: boolean;

    // Submission
    /** Submit the amendment */
    handleSubmit: () => Promise<void>;
    /** Whether submission is in progress */
    isSubmitting: boolean;

    // Submission dialog state
    /** Whether to show the submission progress dialog */
    showSubmissionDialog: boolean;
    /** Setter for submission dialog visibility */
    setShowSubmissionDialog: (show: boolean) => void;
    /** Current submission state (stage, srName, error) */
    submissionState: SubmissionState;
}

/* ─────────────────────────────────────────────────────────────
   HOOK IMPLEMENTATION
   ───────────────────────────────────────────────────────────── */

export const useSRAmendForm = ({
    initialFormValues,
    srName,
    mode,
    onSuccess,
}: UseSRAmendFormProps): UseSRAmendFormReturn => {
    /* ─────────────────────────────────────────────────────────
       STATE
       ───────────────────────────────────────────────────────── */
    const [currentStep, setCurrentStep] = useState(0);
    const [submissionState, setSubmissionState] = useState<SubmissionState>({
        stage: "idle",
    });
    const [showSubmissionDialog, setShowSubmissionDialog] = useState(false);

    /* ─────────────────────────────────────────────────────────
       USER DATA & FRAPPE API
       ───────────────────────────────────────────────────────── */
    const userData = useUserData();
    const { updateDoc, loading: updateLoading } = useFrappeUpdateDoc();
    const { createDoc, loading: createLoading } = useFrappeCreateDoc();

    /* ─────────────────────────────────────────────────────────
       FORM SETUP
       ───────────────────────────────────────────────────────── */
    const form = useForm<SRFormValues>({
        resolver: zodResolver(srFormSchema),
        defaultValues: initialFormValues,
        mode: "onChange",
    });

    const { trigger, getValues, reset } = form;

    /* ─────────────────────────────────────────────────────────
       RESET FORM WHEN INITIAL VALUES BECOME AVAILABLE
       ───────────────────────────────────────────────────────── */
    useEffect(() => {
        if (initialFormValues) {
            reset(initialFormValues);
        }
    }, [initialFormValues, reset]);

    /* ─────────────────────────────────────────────────────────
       CURRENT SECTION INFO
       ───────────────────────────────────────────────────────── */
    const currentSection = getSectionByIndex(currentStep);
    const sectionTitle = SR_SECTION_TITLES[currentSection];
    const sectionDescription = SR_SECTION_DESCRIPTIONS[currentSection];
    const isFirstStep = checkIsFirstStep(currentSection);
    const isLastStep = checkIsLastStep(currentSection);

    /* ─────────────────────────────────────────────────────────
       STEP VALIDATION
       ───────────────────────────────────────────────────────── */
    const validateCurrentStep = useCallback(async (): Promise<ValidationResult> => {
        const formValues = getValues();
        const section = getSectionByIndex(currentStep);

        switch (section) {
            case "items":
                return validateStep1(formValues);
            case "vendor":
                return validateStep2(formValues);
            case "review":
                // Full validation on review step
                const result = srFormSchema.safeParse(formValues);
                if (!result.success) {
                    return {
                        success: false,
                        error: result.error.errors[0]?.message || "Please review all details.",
                    };
                }
                // Also check step 2 validation logic (total > 0 etc.)
                return validateStep2(formValues);
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
            // Trigger form validation to show errors
            await trigger();
            toast({
                title: "Validation Error",
                description:
                    validationResult.error || "Please complete all required fields before proceeding.",
                variant: "destructive",
            });
            return;
        }

        if (currentStep < SR_SECTIONS.length - 1) {
            setCurrentStep((prev) => prev + 1);
        }
    }, [currentStep, validateCurrentStep, trigger]);

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
                const validationResult = await validateCurrentStep();
                if (validationResult.success && stepIndex === currentStep + 1) {
                    setCurrentStep(stepIndex);
                } else if (!validationResult.success) {
                    toast({
                        title: "Validation Error",
                        description:
                            validationResult.error || "Please complete all required fields before proceeding.",
                        variant: "destructive",
                    });
                }
            }
        },
        [currentStep, validateCurrentStep]
    );

    /* ─────────────────────────────────────────────────────────
       SUBMISSION HANDLER
       ───────────────────────────────────────────────────────── */
    const handleSubmit = useCallback(async () => {
        const formValues = getValues();

        // Final validation
        const validation = srFormSchema.safeParse(formValues);
        if (!validation.success) {
            toast({
                title: "Validation Error",
                description: validation.error.errors[0]?.message || "Please ensure all required fields are filled.",
                variant: "destructive",
            });
            return;
        }

        // Additional business validation (Total > 0, etc.)
        const step2Val = validateStep2(formValues);
        if (!step2Val.success) {
            toast({
                title: "Validation Error",
                description: step2Val.error || "Please ensure all rates are entered correctly.",
                variant: "destructive",
            });
            return;
        }

        setShowSubmissionDialog(true);
        setSubmissionState({ stage: "updating-sr" });

        try {
            // Determine the target status based on mode
            const targetStatus =
                mode === "rejected" ? "Vendor Selected" : "Amendment";

            // Transform form values to SR payload
            const payload = transformFormValuesToSRPayload(formValues);

            // Update the Service Request document
            await updateDoc("Service Requests", srName, {
                ...payload,
                status: targetStatus,
            });

            setSubmissionState({ stage: "adding-comment", srName });

            // Add comment if provided
            if (formValues.comments?.trim()) {
                try {
                    const commentSubject =
                        mode === "rejected"
                            ? "editing rejected work order"
                            : "amending approved work order";

                    await createDoc("Nirmaan Comments", {
                        comment_type: "Comment",
                        reference_doctype: "Service Requests",
                        reference_name: srName,
                        comment_by: userData?.user_id,
                        content: formValues.comments.trim(),
                        subject: commentSubject,
                    });
                } catch (commentError) {
                    console.warn("Failed to add comment:", commentError);
                    // Don't fail the whole operation for comment failure
                }
            }

            // Success
            setSubmissionState({ stage: "complete", srName });

            const successMessage =
                mode === "rejected"
                    ? `Work Order ${srName} updated and resubmitted for approval.`
                    : `Work Order ${srName} amendment submitted for review.`;

            toast({
                title: "Success!",
                description: successMessage,
                variant: "success",
            });

            // Callback for success
            if (onSuccess) {
                // Small delay to let user see success state
                setTimeout(() => {
                    onSuccess(srName);
                }, 1500);
            }
        } catch (error: any) {
            console.error("SR amendment error:", error);
            setSubmissionState({
                stage: "error",
                error: error?.message || "Failed to update Work Order",
            });

            toast({
                title: "Update Failed!",
                description: error?.message || "Failed to update Work Order",
                variant: "destructive",
            });
        }
    }, [
        getValues,
        mode,
        srName,
        updateDoc,
        createDoc,
        userData?.user_id,
        onSuccess,
    ]);

    /* ─────────────────────────────────────────────────────────
       RETURN
       ───────────────────────────────────────────────────────── */
    return {
        // Form
        form,
        currentStep,
        currentSection,
        sectionTitle,
        sectionDescription,

        // Navigation
        handleNext,
        handlePrevious,
        handleStepClick,
        isFirstStep,
        isLastStep,

        // Submission
        handleSubmit,
        isSubmitting: updateLoading || createLoading,

        // Submission dialog state
        showSubmissionDialog,
        setShowSubmissionDialog,
        submissionState,
    };
};

export default useSRAmendForm;
