import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useFrappePostCall, useFrappeCreateDoc, useFrappeUpdateDoc } from "frappe-react-sdk";
import { useNavigate } from "react-router-dom";
import { X } from "lucide-react";

import { FormSkeleton } from "@/components/ui/skeleton";
import { Form } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { WizardSteps } from "@/components/ui/wizard-steps";
import { DraftIndicator, DraftHeader } from "@/components/ui/draft-indicator";
import { DraftCancelDialog } from "@/components/ui/draft-cancel-dialog";
import { DraftResumeDialog } from "@/components/ui/draft-resume-dialog";
import { ProjectCreationDialog, CreationStage } from "@/components/ui/project-creation-dialog";
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

    // Creation dialog state
    const [creationStage, setCreationStage] = useState<CreationStage>("idle");
    const [creationDialogOpen, setCreationDialogOpen] = useState(false);
    const [assigneeCount, setAssigneeCount] = useState(0);
    const [progressSetupEnabled, setProgressSetupEnabled] = useState(false);
    const [creationError, setCreationError] = useState<string>();

    // API calls
    const { call: createProjectAndAddress, loading: createProjectAndAddressLoading } =
        useFrappePostCall("nirmaan_stack.api.projects.new_project.create_project_with_address");
    const { createDoc } = useFrappeCreateDoc();
    const { updateDoc } = useFrappeUpdateDoc();

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
            // Validation
            if (values.project_city === "Not Found" || values.project_state === "Not Found") {
                throw new Error('City and State are "Not Found", Please Enter a Valid Pincode!');
            }
            if (!values.project_end_date) {
                throw new Error("Project End Date must not be empty!");
            }
            if (!values.project_work_packages.work_packages.length) {
                throw new Error("Please select at least one work package associated with this project!");
            }

            // Extract assignees, daily_progress_setup, and deprecated single-assignee fields (not sent to backend)
            const {
                assignees,
                daily_progress_setup,
                // Deprecated single-assignee fields - don't send to backend
                project_lead,
                project_manager,
                design_lead,
                procurement_lead,
                estimates_exec,
                ...projectValues
            } = values;

            // Collect unique users from assignees
            const uniqueUsers = new Set<string>();
            assignees?.project_leads?.forEach((u) => uniqueUsers.add(u.value));
            assignees?.project_managers?.forEach((u) => uniqueUsers.add(u.value));
            assignees?.procurement_executives?.forEach((u) => uniqueUsers.add(u.value));
            const userCount = uniqueUsers.size;
            setAssigneeCount(userCount);

            // Check if progress setup is enabled
            const isProgressSetupEnabled = daily_progress_setup?.enabled === true;
            setProgressSetupEnabled(isProgressSetupEnabled);

            // Open dialog and start creation
            setCreationDialogOpen(true);
            setCreationStage("creating_project");
            setCreationError(undefined);

            // Step 1: Create project
            const response = await createProjectAndAddress({
                values: { ...projectValues, areaNames },
            });

            if (response.message.status !== 200) {
                throw new Error(response.message.error || "Failed to create project");
            }

            const projectName = response.message.project_name;
            setNewProjectId(projectName);

            // Step 2: Assign users (create User Permissions)
            if (userCount > 0) {
                setCreationStage("assigning_users");

                // Create User Permission for each unique user
                for (const userId of uniqueUsers) {
                    try {
                        await createDoc("User Permission", {
                            user: userId,
                            allow: "Projects",
                            for_value: projectName,
                        });
                    } catch (permError) {
                        // Log but don't fail the entire operation
                        console.warn(`Failed to create permission for ${userId}:`, permError);
                    }
                }
            }

            // Step 3: Set up Daily Progress Tracking (if enabled)
            if (isProgressSetupEnabled && daily_progress_setup) {
                setCreationStage("setting_up_progress");

                try {
                    // Prepare zones for backend (field name is zone_name in Project Zone Child Table)
                    const zonesToSave = daily_progress_setup.zone_type === 'single'
                        ? [{ zone_name: "Default" }]
                        : daily_progress_setup.zones.map(z => ({ zone_name: z.zone_name }));

                    // Prepare work headers for backend (Project Work Headers child table)
                    // Fields: project_work_header_name (Link to Work Headers), enabled
                    // Note: enabled must be string "True" to match the reading code filter
                    const headersToSave = daily_progress_setup.work_headers.map(wh => ({
                        project_work_header_name: wh.work_header_doc_name,
                        enabled: "True",
                    }));

                    // Debug logging
                    console.log("[Progress Setup] Saving to project:", projectName);
                    console.log("[Progress Setup] Zones:", zonesToSave);
                    console.log("[Progress Setup] Work Headers:", headersToSave);
                    console.log("[Progress Setup] Raw form data:", daily_progress_setup);

                    // Update the project with progress tracking settings
                    const updatePayload = {
                        enable_project_milestone_tracking: true,
                        project_zones: zonesToSave,
                        project_work_header_entries: headersToSave,
                    };
                    console.log("[Progress Setup] Full payload:", updatePayload);

                    await updateDoc("Projects", projectName, updatePayload);
                    console.log("[Progress Setup] Update successful");
                } catch (progressError) {
                    // Log error details
                    console.error("Failed to set up progress tracking:", progressError);
                    // Don't fail the entire operation, but toast the error
                    toast({
                        title: "Warning",
                        description: "Project created but progress tracking setup failed. You can set it up later from the project page.",
                        variant: "destructive",
                    });
                }
            }

            // Complete
            clearDraftAfterSubmit();
            setCreationStage("complete");

        } catch (error: any) {
            setCreationStage("error");
            setCreationError(error?.message || "An unexpected error occurred");
            console.error("Error:", error);
        }
    };

    // Dialog action handlers
    const handleGoToProjects = () => {
        setCreationDialogOpen(false);
        setCreationStage("idle");
        navigate("/projects");
    };

    const handleCreateNew = () => {
        setCreationDialogOpen(false);
        setCreationStage("idle");
        setNewProjectId(undefined);
        form.reset(defaultFormValues);
        form.clearErrors();
        setSection("projectDetails");
        setCurrentStep(0);
    };

    const handleAddEstimates = () => {
        setCreationDialogOpen(false);
        setCreationStage("idle");
        navigate(`/projects/${newProjectId}/add-estimates`);
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
                            <ReviewStep
                                form={form}
                                formData={formData}
                                duration={duration}
                                isSubmitting={createProjectAndAddressLoading || creationDialogOpen}
                                onPrevious={goToPreviousSection}
                                onSubmit={handleSubmit}
                                onNavigateToSection={navigateToSection}
                            />
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

            {/* Project Creation Progress Dialog */}
            <ProjectCreationDialog
                open={creationDialogOpen}
                stage={creationStage}
                projectName={newProjectId}
                assigneeCount={assigneeCount}
                progressSetupEnabled={progressSetupEnabled}
                errorMessage={creationError}
                onGoBack={handleGoToProjects}
                onCreateNew={handleCreateNew}
                onAddEstimates={handleAddEstimates}
            />
        </div>
    );
};

export default ProjectForm;
