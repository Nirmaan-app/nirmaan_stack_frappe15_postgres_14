import { UseFormReturn } from "react-hook-form";
import { Building2, MapPin, Calendar, Users, Package, ListChecks } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ButtonLoading } from "@/components/ui/button-loading";
import {
    ReviewSection,
    ReviewDetail,
    ReviewContainer,
} from "@/components/ui/review-section";
import { PackagesReviewGrid } from "@/components/ui/package-review-card";
import { ProjectFormValues } from "../schema";
import { ProjectFormData } from "../hooks/useProjectFormData";
import { SectionKey } from "../constants";

interface ReviewStepProps {
    form: UseFormReturn<ProjectFormValues>;
    formData: ProjectFormData;
    duration: number;
    isSubmitting: boolean;
    onPrevious: () => void;
    onSubmit: () => void;
    onNavigateToSection: (section: SectionKey) => void;
}

export const ReviewStep: React.FC<ReviewStepProps> = ({
    form,
    formData,
    duration,
    isSubmitting,
    onPrevious,
    onSubmit,
    onNavigateToSection,
}) => {
    const { customers, users } = formData;

    return (
        <>
            <ReviewContainer
                title="Review Your Project"
                description="Verify all details before creating the project"
            >
                {/* Project Details Section */}
                <ReviewSection
                    title="Project Details"
                    icon={Building2}
                    onEdit={() => onNavigateToSection("projectDetails")}
                    iconColorClass="bg-blue-500/10 text-blue-600 dark:text-blue-400"
                >
                    <ReviewDetail
                        label="Project Name"
                        value={form.getValues("project_name")}
                    />
                    <ReviewDetail
                        label="Project Type"
                        value={form.getValues("project_type")}
                    />
                    <ReviewDetail
                        label="Customer"
                        value={
                            form.getValues("customer")
                                ? customers?.find(
                                      (c) => c.name === form.getValues("customer")
                                  )?.company_name
                                : ""
                        }
                    />
                    <ReviewDetail
                        label="Carpet Area (Sqft)"
                        value={form.getValues("carpet_area")}
                    />
                    <ReviewDetail
                        label="GST Locations"
                        value={form
                            .getValues("project_gst_number")
                            ?.list?.map((item) => item.location)
                            .join(", ")}
                    />
                </ReviewSection>

                {/* Address Details Section */}
                <ReviewSection
                    title="Project Address"
                    icon={MapPin}
                    onEdit={() => onNavigateToSection("projectAddressDetails")}
                    iconColorClass="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                    columns={3}
                >
                    <ReviewDetail
                        label="Address Line 1"
                        value={form.getValues("address_line_1")}
                    />
                    <ReviewDetail
                        label="Address Line 2"
                        value={form.getValues("address_line_2")}
                    />
                    <ReviewDetail label="City" value={form.getValues("project_city")} />
                    <ReviewDetail label="State" value={form.getValues("project_state")} />
                    <ReviewDetail label="Pincode" value={form.getValues("pin")} />
                    <ReviewDetail label="Phone" value={form.getValues("phone")} />
                    <ReviewDetail label="Email" value={form.getValues("email")} />
                </ReviewSection>

                {/* Timeline Section */}
                <ReviewSection
                    title="Project Timeline"
                    icon={Calendar}
                    onEdit={() => onNavigateToSection("projectTimeline")}
                    iconColorClass="bg-orange-500/10 text-orange-600 dark:text-orange-400"
                    columns={3}
                >
                    <ReviewDetail
                        label="Start Date"
                        value={form.getValues("project_start_date")?.toLocaleDateString()}
                    />
                    <ReviewDetail
                        label="End Date"
                        value={form.getValues("project_end_date")?.toLocaleDateString()}
                    />
                    <ReviewDetail
                        label="Duration"
                        value={duration ? `${duration} days` : undefined}
                    />
                </ReviewSection>

                {/* Assignees Section */}
                <ReviewSection
                    title="Project Team"
                    icon={Users}
                    onEdit={() => onNavigateToSection("projectAssignees")}
                    iconColorClass="bg-purple-500/10 text-purple-600 dark:text-purple-400"
                >
                    <ReviewDetail
                        label="Project Lead"
                        value={
                            form.getValues("project_lead")
                                ? users?.find(
                                      (u) => u.name === form.getValues("project_lead")
                                  )?.full_name
                                : ""
                        }
                    />
                    <ReviewDetail
                        label="Procurement Lead"
                        value={
                            form.getValues("procurement_lead")
                                ? users?.find(
                                      (u) => u.name === form.getValues("procurement_lead")
                                  )?.full_name
                                : ""
                        }
                    />
                    <ReviewDetail
                        label="Project Manager"
                        value={
                            form.getValues("project_manager")
                                ? users?.find(
                                      (u) => u.name === form.getValues("project_manager")
                                  )?.full_name
                                : ""
                        }
                    />
                    <ReviewDetail
                        label="Accountant"
                        value={
                            form.getValues("accountant")
                                ? users?.find(
                                      (u) => u.name === form.getValues("accountant")
                                  )?.full_name
                                : ""
                        }
                    />
                </ReviewSection>

                {/* Packages Section */}
                <ReviewSection
                    title="Selected Packages"
                    icon={Package}
                    onEdit={() => onNavigateToSection("packageSelection")}
                    iconColorClass="bg-teal-500/10 text-teal-600 dark:text-teal-400"
                    columns={1}
                >
                    <div className="col-span-full">
                        <PackagesReviewGrid
                            workPackages={
                                form.getValues("project_work_packages")?.work_packages || []
                            }
                            onEdit={() => onNavigateToSection("packageSelection")}
                        />
                    </div>
                </ReviewSection>
            </ReviewContainer>

            <div className="pt-2 flex items-center justify-end gap-2">
                <Button variant="outline" onClick={onPrevious}>
                    Previous
                </Button>
                {isSubmitting ? (
                    <ButtonLoading />
                ) : (
                    <Button onClick={onSubmit} className="flex items-center gap-1">
                        <ListChecks className="h-4 w-4" />
                        Submit
                    </Button>
                )}
            </div>
        </>
    );
};

export default ReviewStep;
