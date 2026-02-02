import React from "react";
import {
    ChevronLeft,
    ChevronRight,
    Send,
    Loader2,
    CheckCircle2,
    XCircle,
    FileEdit,
    MessageSquarePlus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { WizardSteps } from "@/components/ui/wizard-steps";
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetFooter,
    SheetHeader,
    SheetTitle,
} from "@/components/ui/sheet";
import {
    AlertDialog,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";

import { useSRAmendData } from "../hooks/useSRAmendData";
import { useSRAmendForm, SubmissionStage } from "./useSRAmendForm";
import { SR_WIZARD_STEPS } from "../constants";
import { ServiceItemsStep, VendorRatesStep, ReviewStep } from "../steps";

/* ─────────────────────────────────────────────────────────────
   PROPS INTERFACE
   ───────────────────────────────────────────────────────────── */

interface SRAmendSheetProps {
    /** The Service Request ID to amend */
    srId: string;
    /** Whether the sheet is open */
    isOpen: boolean;
    /** Callback when sheet open state changes */
    onOpenChange: (open: boolean) => void;
    /** Optional callback on successful amendment */
    onSuccess?: () => void;
}

/* ─────────────────────────────────────────────────────────────
   SUBMISSION STEP CONFIG
   ───────────────────────────────────────────────────────────── */

interface SubmissionStepConfig {
    icon: React.ReactNode;
    label: string;
    activeLabel: string;
}

const SUBMISSION_STEPS: Record<SubmissionStage, SubmissionStepConfig> = {
    idle: {
        icon: <FileEdit className="h-5 w-5" />,
        label: "Preparing...",
        activeLabel: "Preparing amendment...",
    },
    "updating-sr": {
        icon: <FileEdit className="h-5 w-5" />,
        label: "Update Work Order",
        activeLabel: "Updating Work Order...",
    },
    "adding-comment": {
        icon: <MessageSquarePlus className="h-5 w-5" />,
        label: "Add Comment",
        activeLabel: "Adding comment...",
    },
    complete: {
        icon: <CheckCircle2 className="h-5 w-5 text-green-500" />,
        label: "Complete",
        activeLabel: "Amendment submitted!",
    },
    error: {
        icon: <XCircle className="h-5 w-5 text-red-500" />,
        label: "Error",
        activeLabel: "Amendment failed",
    },
};

/* ─────────────────────────────────────────────────────────────
   COMPONENT
   ───────────────────────────────────────────────────────────── */

/**
 * SRAmendSheet - Sheet component for amending approved Service Requests
 *
 * A compact wizard UI inside a Sheet (slide-over panel) that allows users
 * to modify an approved Work Order's items, vendor, and rates.
 *
 * When submitted with mode="approved", the SR status is set to "Amendment"
 * pending re-approval.
 */
export const SRAmendSheet: React.FC<SRAmendSheetProps> = ({
    srId,
    isOpen,
    onOpenChange,
    onSuccess,
}) => {
    /* ─────────────────────────────────────────────────────────
       DATA HOOK
       ───────────────────────────────────────────────────────── */
    const { initialFormValues, categories, vendors, isLoading, hasError } =
        useSRAmendData(srId);

    /* ─────────────────────────────────────────────────────────
       FORM HOOK
       ───────────────────────────────────────────────────────── */
    const {
        form,
        currentStep,
        currentSection,
        sectionTitle,
        sectionDescription,
        handleNext,
        handlePrevious,
        handleStepClick,
        isFirstStep,
        isLastStep,
        handleSubmit,
        isSubmitting,
        showSubmissionDialog,
        setShowSubmissionDialog,
        submissionState,
    } = useSRAmendForm({
        initialFormValues,
        srName: srId,
        mode: "approved",
        onSuccess: () => {
            // Close sheet and call success callback after brief delay
            // to let user see the success state
            setTimeout(() => {
                onOpenChange(false);
                onSuccess?.();
            }, 1500);
        },
    });

    /* ─────────────────────────────────────────────────────────
       RENDER CURRENT STEP
       ───────────────────────────────────────────────────────── */
    const renderCurrentStep = () => {
        switch (currentSection) {
            case "items":
                return (
                    <ServiceItemsStep
                        form={form}
                        categories={categories}
                        isLoading={isLoading}
                    />
                );
            case "vendor":
                return (
                    <VendorRatesStep
                        form={form}
                        vendors={vendors}
                        isLoading={isLoading}
                    />
                );
            case "review":
                return <ReviewStep form={form} />;
            default:
                return null;
        }
    };

    /* ─────────────────────────────────────────────────────────
       RENDER SUBMISSION PROGRESS
       ───────────────────────────────────────────────────────── */
    const renderSubmissionProgress = () => {
        const stages: SubmissionStage[] = ["updating-sr", "adding-comment", "complete"];
        const currentStageIndex = stages.indexOf(submissionState.stage);

        return (
            <div className="space-y-4 py-4">
                {stages.map((stage, index) => {
                    const config = SUBMISSION_STEPS[stage];
                    const isActive = submissionState.stage === stage;
                    const isComplete = currentStageIndex > index;
                    const isError = submissionState.stage === "error" && index === currentStageIndex;

                    return (
                        <div
                            key={stage}
                            className={`flex items-center gap-3 p-3 rounded-lg transition-colors ${
                                isActive
                                    ? "bg-primary/10 border border-primary/20"
                                    : isComplete
                                    ? "bg-green-50 border border-green-200"
                                    : isError
                                    ? "bg-red-50 border border-red-200"
                                    : "bg-gray-50 border border-gray-100"
                            }`}
                        >
                            <div
                                className={`flex-shrink-0 ${
                                    isActive ? "animate-pulse" : ""
                                }`}
                            >
                                {isComplete ? (
                                    <CheckCircle2 className="h-5 w-5 text-green-500" />
                                ) : isError ? (
                                    <XCircle className="h-5 w-5 text-red-500" />
                                ) : (
                                    config.icon
                                )}
                            </div>
                            <div className="flex-1">
                                <p
                                    className={`text-sm font-medium ${
                                        isActive
                                            ? "text-primary"
                                            : isComplete
                                            ? "text-green-700"
                                            : isError
                                            ? "text-red-700"
                                            : "text-gray-500"
                                    }`}
                                >
                                    {isActive ? config.activeLabel : config.label}
                                </p>
                            </div>
                            {isActive && !isError && (
                                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                            )}
                        </div>
                    );
                })}

                {/* Error message */}
                {submissionState.stage === "error" && submissionState.error && (
                    <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                        <p className="text-sm text-red-700">{submissionState.error}</p>
                    </div>
                )}

                {/* Success message */}
                {submissionState.stage === "complete" && (
                    <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-lg">
                        <p className="text-sm text-green-700 font-medium">
                            Amendment submitted successfully!
                        </p>
                        <p className="text-xs text-green-600 mt-1">
                            The Work Order has been sent for re-approval.
                        </p>
                    </div>
                )}
            </div>
        );
    };

    /* ─────────────────────────────────────────────────────────
       RENDER
       ───────────────────────────────────────────────────────── */
    return (
        <Sheet open={isOpen} onOpenChange={onOpenChange}>
            <SheetContent className="overflow-auto md:min-w-[700px] sm:min-w-[500px] flex flex-col">
                {/* Header with title and compact step indicator */}
                <SheetHeader>
                    <SheetTitle>Amend Service Request: {srId}</SheetTitle>
                    <SheetDescription>
                        Step {currentStep + 1} of {SR_WIZARD_STEPS.length}:{" "}
                        {sectionTitle}
                    </SheetDescription>
                </SheetHeader>

                {/* Submission Progress Dialog */}
                <AlertDialog
                    open={showSubmissionDialog}
                    onOpenChange={(open) => {
                        // Only allow closing on error state
                        if (!open && submissionState.stage === "error") {
                            setShowSubmissionDialog(false);
                        }
                    }}
                >
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle className="flex items-center gap-2">
                                {submissionState.stage === "complete" ? (
                                    <>
                                        <CheckCircle2 className="h-5 w-5 text-green-500" />
                                        Amendment Submitted
                                    </>
                                ) : submissionState.stage === "error" ? (
                                    <>
                                        <XCircle className="h-5 w-5 text-red-500" />
                                        Amendment Failed
                                    </>
                                ) : (
                                    <>
                                        <Loader2 className="h-5 w-5 animate-spin" />
                                        Submitting Amendment...
                                    </>
                                )}
                            </AlertDialogTitle>
                            <AlertDialogDescription>
                                {submissionState.stage === "complete"
                                    ? "Your amendment has been submitted for review."
                                    : submissionState.stage === "error"
                                    ? "There was an error submitting your amendment."
                                    : "Please wait while we process your amendment."}
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        {renderSubmissionProgress()}
                        {submissionState.stage === "error" && (
                            <div className="flex justify-end">
                                <Button
                                    variant="outline"
                                    onClick={() => setShowSubmissionDialog(false)}
                                >
                                    Close
                                </Button>
                            </div>
                        )}
                    </AlertDialogContent>
                </AlertDialog>

                {/* Loading state */}
                {isLoading ? (
                    <div className="flex-1 flex items-center justify-center">
                        <div className="text-center">
                            <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" />
                            <p className="mt-2 text-sm text-muted-foreground">
                                Loading service request...
                            </p>
                        </div>
                    </div>
                ) : hasError ? (
                    <div className="flex-1 flex items-center justify-center">
                        <div className="text-center">
                            <XCircle className="h-8 w-8 text-red-500 mx-auto" />
                            <p className="mt-2 text-sm text-red-600">
                                Failed to load service request data.
                            </p>
                            <p className="text-xs text-muted-foreground mt-1">
                                Please try again or contact support.
                            </p>
                        </div>
                    </div>
                ) : (
                    <>
                        {/* Compact WizardSteps */}
                        <div className="py-4">
                            <WizardSteps
                                steps={SR_WIZARD_STEPS}
                                currentStep={currentStep}
                                onStepClick={handleStepClick}
                            />
                        </div>

                        {/* Scrollable content area */}
                        <div className="flex-1 overflow-y-auto py-4">
                            <div className="mb-4">
                                <p className="text-sm text-muted-foreground">
                                    {sectionDescription}
                                </p>
                            </div>

                            {/* Step component */}
                            {renderCurrentStep()}
                        </div>

                        {/* Footer with nav buttons */}
                        <SheetFooter className="flex-shrink-0 pt-4 border-t">
                            <div className="flex w-full justify-between">
                                <Button
                                    variant="outline"
                                    onClick={handlePrevious}
                                    disabled={isFirstStep || isSubmitting}
                                >
                                    <ChevronLeft className="h-4 w-4 mr-2" />
                                    Previous
                                </Button>

                                {isLastStep ? (
                                    <Button
                                        onClick={handleSubmit}
                                        disabled={isSubmitting}
                                    >
                                        {isSubmitting ? (
                                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                        ) : (
                                            <Send className="h-4 w-4 mr-2" />
                                        )}
                                        Submit Amendment
                                    </Button>
                                ) : (
                                    <Button onClick={handleNext} disabled={isSubmitting}>
                                        Next
                                        <ChevronRight className="h-4 w-4 ml-2" />
                                    </Button>
                                )}
                            </div>
                        </SheetFooter>
                    </>
                )}
            </SheetContent>
        </Sheet>
    );
};

export default SRAmendSheet;
