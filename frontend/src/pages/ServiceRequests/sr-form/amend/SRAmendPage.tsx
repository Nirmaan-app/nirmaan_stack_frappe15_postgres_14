import { useNavigate, useParams } from "react-router-dom";
import { ChevronLeft, ChevronRight, Send, Loader2, CheckCircle2 } from "lucide-react";

// UI Components
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { WizardSteps } from "@/components/ui/wizard-steps";
import {
    AlertDialog,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// Hooks & Data
import { useSRAmendData } from "../hooks/useSRAmendData";
import { useSRAmendForm } from "./useSRAmendForm";

// Schema & Constants
import { SR_WIZARD_STEPS } from "../constants";

// Step Components
import { ServiceItemsStep, VendorRatesStep, ReviewStep } from "../steps";

/* ─────────────────────────────────────────────────────────────
   SR AMEND PAGE COMPONENT

   Full page wizard for amending rejected work orders.
   Route: /service-requests/:srId/amend

   Uses the same layout as the create wizard (SRFormWizard) but:
   - No draft management
   - Pre-populated from existing SR document
   - Updates status to "Vendor Selected" on submission
   ───────────────────────────────────────────────────────────── */

export const SRAmendPage = () => {
    const navigate = useNavigate();
    const { srId } = useParams<{ srId: string }>();

    /* ─────────────────────────────────────────────────────────
       DATA FETCHING
       ───────────────────────────────────────────────────────── */
    const {
        srDoc,
        initialFormValues,
        categories,
        vendors,
        project,
        isLoading: dataLoading,
        hasError,
    } = useSRAmendData(srId);

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
        srName: srId!,
        mode: "rejected",
        onSuccess: () => {
            navigate("/service-requests");
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
                return <ReviewStep form={form} />;
            default:
                return null;
        }
    };

    /* ─────────────────────────────────────────────────────────
       LOADING STATE
       ───────────────────────────────────────────────────────── */
    if (dataLoading) {
        return (
            <div className="flex items-center justify-center h-[60vh]">
                <div className="flex flex-col items-center gap-4">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    <p className="text-muted-foreground">Loading work order data...</p>
                </div>
            </div>
        );
    }

    /* ─────────────────────────────────────────────────────────
       ERROR STATE
       ───────────────────────────────────────────────────────── */
    if (hasError || !srDoc) {
        return (
            <div className="flex items-center justify-center h-[60vh]">
                <div className="flex flex-col items-center gap-4">
                    <p className="text-destructive">Failed to load work order data.</p>
                    <Button variant="outline" onClick={() => navigate("/service-requests")}>
                        Return to Service Requests
                    </Button>
                </div>
            </div>
        );
    }

    /* ─────────────────────────────────────────────────────────
       MAIN RENDER
       ───────────────────────────────────────────────────────── */
    return (
        <div className="flex-1 space-y-4">
            {/* Submission Progress Dialog */}
            <AlertDialog open={showSubmissionDialog} onOpenChange={setShowSubmissionDialog}>
                <AlertDialogContent className="sm:max-w-md">
                    <AlertDialogHeader>
                        <AlertDialogTitle className="text-center">
                            {submissionState.stage === "error"
                                ? "Update Failed"
                                : submissionState.stage === "complete"
                                    ? "Work Order Updated!"
                                    : "Updating Work Order..."}
                        </AlertDialogTitle>
                        <AlertDialogDescription asChild>
                            <div className="space-y-4 pt-4">
                                {/* Stage: Updating SR */}
                                <div className="flex items-center gap-3">
                                    {submissionState.stage === "updating-sr" ? (
                                        <Loader2 className="h-5 w-5 animate-spin text-primary" />
                                    ) : submissionState.stage === "error" ? (
                                        <div className="h-5 w-5 rounded-full bg-destructive/20 flex items-center justify-center">
                                            <span className="text-destructive text-xs">!</span>
                                        </div>
                                    ) : (
                                        <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                                    )}
                                    <span
                                        className={
                                            submissionState.stage === "updating-sr"
                                                ? "text-foreground font-medium"
                                                : "text-muted-foreground"
                                        }
                                    >
                                        Updating Work Order document
                                    </span>
                                </div>

                                {/* Stage: Adding Comment */}
                                <div className="flex items-center gap-3">
                                    {submissionState.stage === "adding-comment" ? (
                                        <Loader2 className="h-5 w-5 animate-spin text-primary" />
                                    ) : ["complete"].includes(submissionState.stage) ? (
                                        <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                                    ) : (
                                        <div className="h-5 w-5 rounded-full bg-muted" />
                                    )}
                                    <span
                                        className={
                                            submissionState.stage === "adding-comment"
                                                ? "text-foreground font-medium"
                                                : "text-muted-foreground"
                                        }
                                    >
                                        Adding comments
                                    </span>
                                </div>

                                {/* Error Message */}
                                {submissionState.stage === "error" && submissionState.error && (
                                    <div className="mt-4 p-3 bg-destructive/10 rounded-lg border border-destructive/20">
                                        <p className="text-sm text-destructive">{submissionState.error}</p>
                                    </div>
                                )}

                                {/* Success Message */}
                                {submissionState.stage === "complete" && submissionState.srName && (
                                    <div className="mt-4 p-3 bg-emerald-50 dark:bg-emerald-950/30 rounded-lg border border-emerald-200 dark:border-emerald-800">
                                        <p className="text-sm text-emerald-700 dark:text-emerald-400">
                                            Work Order <strong>{submissionState.srName}</strong> has been updated
                                            and resubmitted for approval.
                                        </p>
                                    </div>
                                )}

                                {/* Close Button for Error State */}
                                {submissionState.stage === "error" && (
                                    <Button
                                        variant="outline"
                                        className="w-full mt-4"
                                        onClick={() => {
                                            setShowSubmissionDialog(false);
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

            {/* Header */}
            <div className="flex items-center justify-between gap-4 px-4 sm:px-0">
                <div>
                    <h1 className="text-xl font-semibold tracking-tight">Amend Work Order</h1>
                    {project && (
                        <p className="text-sm text-muted-foreground">
                            {project.project_name}
                        </p>
                    )}
                    <p className="text-sm text-muted-foreground">
                        Editing: {srId}
                    </p>
                </div>
            </div>

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
                    disabled={isFirstStep}
                    className="gap-2"
                >
                    <ChevronLeft className="h-4 w-4" />
                    Previous
                </Button>

                {isLastStep ? (
                    <Button
                        onClick={handleSubmit}
                        disabled={isSubmitting}
                        className="gap-2"
                    >
                        {isSubmitting ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                            <Send className="h-4 w-4" />
                        )}
                        Resubmit for Approval
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

export const Component = SRAmendPage;
export default SRAmendPage;
