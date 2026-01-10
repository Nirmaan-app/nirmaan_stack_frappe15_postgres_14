import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useFrappePostCall } from "frappe-react-sdk";
import { useNavigate } from "react-router-dom";
import { BadgeIndianRupee, CirclePlus, Undo2, X } from "lucide-react";

import { FormSkeleton } from "@/components/ui/skeleton";
import { Form } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { WizardSteps } from "@/components/ui/wizard-steps";
import { DraftIndicator, DraftHeader } from "@/components/ui/draft-indicator";
import { DraftCancelDialog } from "@/components/ui/draft-cancel-dialog";
import { DraftResumeDialog } from "@/components/ui/draft-resume-dialog";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogContent,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/components/ui/use-toast";
import { useProjectDraftManager } from "@/hooks/useProjectDraftManager";

import { projectFormSchema, ProjectFormValues, defaultFormValues, sectionFields } from "./schema";
import { wizardStepsConfig, sections, SectionKey, getNextSection, getPreviousSection } from "./constants";
import { useProjectFormData } from "./hooks/useProjectFormData";
import {
    ProjectDetailsStep,
    ProjectAddressStep,
    ProjectTimelineStep,
    ProjectAssigneesStep,
    PackageSelectionStep,
    ReviewStep,
} from "./steps";

/**
 * ProjectForm Component
 *
 * Multi-step wizard for creating new projects.
 * Refactored into modular steps for maintainability.
 */
export const ProjectForm = () => {
    const navigate = useNavigate();
    const { toast } = useToast();

    // Form initialization
    const form = useForm<ProjectFormValues>({
        resolver: zodResolver(projectFormSchema),
        mode: "onBlur",
        defaultValues: defaultFormValues,
    });

    // Fetch all form data
    const formData = useProjectFormData();

    // Wizard state
    const [section, setSection] = useState<SectionKey>("projectDetails");
    const [currentStep, setCurrentStep] = useState(0);
    const [areaNames, setAreaNames] = useState<{ name: string; status: string }[]>([]);
    const [newProjectId, setNewProjectId] = useState<string>();
    const [duration, setDuration] = useState(0);

    // API call
    const { call: createProjectAndAddress, loading: createProjectAndAddressLoading } =
        useFrappePostCall("nirmaan_stack.api.projects.new_project.create_project_with_address");

    // Draft management
    const {
        lastSavedText,
        isSaving,
        draftProjectName,
        draftLastSavedAt,
        showResumeDialog,
        setShowResumeDialog,
        showCancelDialog,
        setShowCancelDialog,
        saveDraftNow,
        resumeDraft,
        discardDraft,
        clearDraftAfterSubmit,
    } = useProjectDraftManager({
        form,
        areaNames,
        setAreaNames,
        currentStep,
        section,
        setCurrentStep,
        setSection,
    });

    // Calculate duration when dates change
    const startDate = form.watch("project_start_date");
    const endDate = form.watch("project_end_date");

    useEffect(() => {
        if (startDate && endDate) {
            const durationInDays = Math.round(
                (endDate.getTime() - startDate.getTime()) / (1000 * 3600 * 24)
            );
            setDuration(durationInDays);
        }
    }, [startDate, endDate]);

    // Navigation handlers
    const goToNextSection = async () => {
        const fieldsToValidate = sectionFields[section] || [];
        const isValid = await form.trigger(fieldsToValidate as any);

        // GST validation
        const gstList = form.getValues("project_gst_number.list");
        if (!gstList || gstList.length === 0) {
            toast({
                title: "Failed!",
                description: "At least one Project GST location must be selected.",
                variant: "destructive",
            });
            return;
        }

        // End date validation
        if (section === "projectTimeline" && !form.getValues("project_end_date")) {
            toast({
                title: "Failed!",
                description: "Project End Date must not be empty",
                variant: "destructive",
            });
            return;
        }

        // Work packages validation
        if (
            section === "packageSelection" &&
            !form.getValues("project_work_packages.work_packages").length
        ) {
            toast({
                title: "Failed!",
                description: "At least one work package must be selected!",
                variant: "destructive",
            });
            return;
        }

        if (isValid) {
            const nextSec = getNextSection(section);
            const nextIndex = currentStep + 1;
            setSection(nextSec);
            if (sections[nextIndex] === nextSec) {
                setCurrentStep(nextIndex);
            }
        }
    };

    const goToPreviousSection = () => {
        const prevSec = getPreviousSection(section);
        setSection(prevSec);
        setCurrentStep((prev) => Math.max(0, prev - 1));
    };

    const navigateToSection = (sectionKey: SectionKey) => {
        setSection(sectionKey);
        const index = sections.findIndex((val) => val === sectionKey);
        setCurrentStep(index);
    };

    // Form submission
    const handleSubmit = async () => {
        const values = form.getValues();

        try {
            if (values.project_city === "Not Found" || values.project_state === "Not Found") {
                throw new Error('City and State are "Not Found", Please Enter a Valid Pincode!');
            }
            if (!values.project_end_date) {
                throw new Error("Project End Date must not be empty!");
            }
            if (!values.project_work_packages.work_packages.length) {
                throw new Error("Please select at least one work package associated with this project!");
            }

            const response = await createProjectAndAddress({
                values: { ...values, areaNames },
            });

            if (response.message.status === 200) {
                clearDraftAfterSubmit();
                toast({
                    title: "Success!",
                    description: `Project ${response.message.project_name} created successfully!`,
                    variant: "success",
                });
                setNewProjectId(response.message.project_name);
                document.getElementById("alertOpenProject")?.click();
            } else if (response.message.status === 400) {
                toast({
                    title: "Failed!",
                    description: response.message.error,
                    variant: "destructive",
                });
            }
        } catch (error: any) {
            toast({
                title: "Failed!",
                description: error?.message,
                variant: "destructive",
            });
            console.error("Error:", error);
        }
    };

    // Loading state
    if (formData.isLoading) {
        return <FormSkeleton />;
    }

    if (formData.workPackagesError) {
        return <div>{formData.workPackagesError?.message}</div>;
    }

    return (
        <div className="flex-1 space-y-4">
            {/* Draft Header */}
            <DraftHeader>
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowCancelDialog(true)}
                    className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground -ml-2"
                >
                    <X className="h-4 w-4" />
                    <span className="hidden sm:inline">Cancel</span>
                </Button>
                <DraftIndicator lastSavedText={lastSavedText} isSaving={isSaving} />
            </DraftHeader>

            {/* Wizard Steps */}
            <WizardSteps
                steps={wizardStepsConfig}
                currentStep={currentStep}
                onStepClick={(stepIndex) => {
                    if (currentStep >= stepIndex) {
                        setSection(sections[stepIndex]);
                        setCurrentStep(stepIndex);
                    }
                }}
                className="px-4 sm:px-6"
            />

            {/* Form */}
            <Form {...form}>
                <form
                    onSubmit={(event) => {
                        event.stopPropagation();
                        return form.handleSubmit(handleSubmit)(event);
                    }}
                    className="max-sm:px-4 px-8"
                >
                    <div className="flex flex-col gap-4">
                        {section === "projectDetails" && (
                            <ProjectDetailsStep
                                form={form}
                                formData={formData}
                                onNext={goToNextSection}
                            />
                        )}

                        {section === "projectAddressDetails" && (
                            <ProjectAddressStep
                                form={form}
                                formData={formData}
                                onNext={goToNextSection}
                                onPrevious={goToPreviousSection}
                            />
                        )}

                        {section === "projectTimeline" && (
                            <ProjectTimelineStep
                                form={form}
                                onNext={goToNextSection}
                                onPrevious={goToPreviousSection}
                            />
                        )}

                        {section === "projectAssignees" && (
                            <ProjectAssigneesStep
                                form={form}
                                formData={formData}
                                onNext={goToNextSection}
                                onPrevious={goToPreviousSection}
                            />
                        )}

                        {section === "packageSelection" && (
                            <PackageSelectionStep
                                form={form}
                                formData={formData}
                                onNext={goToNextSection}
                                onPrevious={goToPreviousSection}
                            />
                        )}

                        {section === "reviewDetails" && (
                            <>
                                <ReviewStep
                                    form={form}
                                    formData={formData}
                                    duration={duration}
                                    isSubmitting={createProjectAndAddressLoading}
                                    onPrevious={goToPreviousSection}
                                    onSubmit={handleSubmit}
                                    onNavigateToSection={navigateToSection}
                                />

                                {/* Success Dialog */}
                                <AlertDialog>
                                    <AlertDialogTrigger asChild>
                                        <button className="hidden" id="alertOpenProject">
                                            Trigger Dialog
                                        </button>
                                    </AlertDialogTrigger>
                                    <AlertDialogContent>
                                        <AlertDialogHeader className="flex items-center justify-center">
                                            <AlertDialogTitle className="text-green-500">
                                                Project Created Successfully! You can start adding
                                                project estimates.
                                            </AlertDialogTitle>
                                            <div className="flex gap-2">
                                                <AlertDialogAction
                                                    onClick={() => navigate("/projects")}
                                                    className="flex items-center gap-1 bg-gray-100 text-black"
                                                >
                                                    <Undo2 className="h-4 w-4" />
                                                    Go Back
                                                </AlertDialogAction>
                                                <AlertDialogAction
                                                    onClick={() => {
                                                        form.reset();
                                                        form.clearErrors();
                                                    }}
                                                    className="flex items-center gap-1"
                                                >
                                                    <CirclePlus className="h-4 w-4" />
                                                    Create New
                                                </AlertDialogAction>
                                                <AlertDialogAction
                                                    onClick={() =>
                                                        navigate(
                                                            `/projects/${newProjectId}/add-estimates`
                                                        )
                                                    }
                                                    className="flex items-center gap-1 bg-gray-100 text-black"
                                                >
                                                    <BadgeIndianRupee className="h-4 w-4" />
                                                    Next: Fill Estimates
                                                </AlertDialogAction>
                                            </div>
                                        </AlertDialogHeader>
                                    </AlertDialogContent>
                                </AlertDialog>
                            </>
                        )}
                    </div>
                </form>
            </Form>

            {/* Draft Resume Dialog */}
            <DraftResumeDialog
                open={showResumeDialog}
                onOpenChange={setShowResumeDialog}
                onResume={resumeDraft}
                onStartFresh={discardDraft}
                draftDate={draftLastSavedAt}
                projectName={draftProjectName}
                currentStep={currentStep}
                totalSteps={sections.length}
            />

            {/* Draft Cancel Dialog */}
            <DraftCancelDialog
                open={showCancelDialog}
                onOpenChange={setShowCancelDialog}
                onSaveDraft={() => {
                    saveDraftNow();
                    navigate("/projects");
                }}
                onDiscard={() => {
                    discardDraft();
                    navigate("/projects");
                }}
                onCancel={() => setShowCancelDialog(false)}
                currentStep={currentStep + 1}
                totalSteps={sections.length}
            />
        </div>
    );
};

export default ProjectForm;
