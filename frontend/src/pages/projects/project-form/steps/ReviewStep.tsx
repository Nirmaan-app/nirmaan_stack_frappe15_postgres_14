import { UseFormReturn } from "react-hook-form";
import { Building2, MapPin, Calendar, Users, Package, ListChecks, ClipboardList, PenTool, AlertCircle } from "lucide-react";
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
    const { customers } = formData;

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
                        label="Nirmaan GST for billing"
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
                    columns={1}
                >
                    <div className="col-span-full space-y-4">
                        {/* Project Leads */}
                        <div>
                            <p className="text-xs font-medium text-gray-500 mb-2">Project Leads</p>
                            <div className="flex flex-wrap gap-2">
                                {form.getValues("assignees.project_leads")?.length ? (
                                    form.getValues("assignees.project_leads")?.map((user) => (
                                        <span
                                            key={user.value}
                                            className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium bg-sky-50 text-sky-700 border border-sky-200"
                                        >
                                            {user.label}
                                        </span>
                                    ))
                                ) : (
                                    <span className="text-xs text-gray-400 italic">No project leads assigned</span>
                                )}
                            </div>
                        </div>

                        {/* Project Managers */}
                        <div>
                            <p className="text-xs font-medium text-gray-500 mb-2">Project Managers</p>
                            <div className="flex flex-wrap gap-2">
                                {form.getValues("assignees.project_managers")?.length ? (
                                    form.getValues("assignees.project_managers")?.map((user) => (
                                        <span
                                            key={user.value}
                                            className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium bg-purple-50 text-purple-700 border border-purple-200"
                                        >
                                            {user.label}
                                        </span>
                                    ))
                                ) : (
                                    <span className="text-xs text-gray-400 italic">No project managers assigned</span>
                                )}
                            </div>
                        </div>

                        {/* Procurement Executives */}
                        <div>
                            <p className="text-xs font-medium text-gray-500 mb-2">Procurement Executives</p>
                            <div className="flex flex-wrap gap-2">
                                {form.getValues("assignees.procurement_executives")?.length ? (
                                    form.getValues("assignees.procurement_executives")?.map((user) => (
                                        <span
                                            key={user.value}
                                            className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200"
                                        >
                                            {user.label}
                                        </span>
                                    ))
                                ) : (
                                    <span className="text-xs text-gray-400 italic">No procurement executives assigned</span>
                                )}
                            </div>
                        </div>
                    </div>
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

                {/* Daily Progress Reports Section (only show if enabled) */}
                {form.getValues("daily_progress_setup")?.enabled && (
                    <ReviewSection
                        title="Daily Progress Reports"
                        icon={ClipboardList}
                        onEdit={() => onNavigateToSection("packageSelection")}
                        iconColorClass="bg-indigo-500/10 text-indigo-600 dark:text-indigo-400"
                        columns={1}
                    >
                        <div className="col-span-full space-y-4">
                            {/* Zone Configuration */}
                            <div>
                                <p className="text-xs font-medium text-gray-500 mb-2">Zone Configuration</p>
                                <div className="flex flex-wrap gap-2">
                                    {form.getValues("daily_progress_setup")?.zone_type === 'single' ? (
                                        <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium bg-gray-100 text-gray-700 border border-gray-200">
                                            Single Zone (Default)
                                        </span>
                                    ) : (
                                        <>
                                            {form.getValues("daily_progress_setup")?.zones?.map((zone) => (
                                                <span
                                                    key={zone.zone_name}
                                                    className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium bg-indigo-50 text-indigo-700 border border-indigo-200"
                                                >
                                                    {zone.zone_name}
                                                </span>
                                            ))}
                                        </>
                                    )}
                                </div>
                            </div>

                            {/* Work Headers */}
                            <div>
                                <p className="text-xs font-medium text-gray-500 mb-2">Work Headers to Track</p>
                                <div className="flex flex-wrap gap-2">
                                    {form.getValues("daily_progress_setup")?.work_headers?.length ? (
                                        form.getValues("daily_progress_setup")?.work_headers?.map((header) => (
                                            <span
                                                key={header.work_header_doc_name}
                                                className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium bg-teal-50 text-teal-700 border border-teal-200"
                                            >
                                                {header.work_header_display_name}
                                            </span>
                                        ))
                                    ) : (
                                        <span className="text-xs text-gray-400 italic">No work headers selected</span>
                                    )}
                                </div>
                                {(form.getValues("daily_progress_setup")?.work_headers?.length ?? 0) > 0 && (
                                    <p className="text-xs text-gray-400 mt-2">
                                        {form.getValues("daily_progress_setup")?.work_headers?.length ?? 0} work header
                                        {(form.getValues("daily_progress_setup")?.work_headers?.length ?? 0) !== 1 ? 's' : ''} across{' '}
                                        {new Set(form.getValues("daily_progress_setup")?.work_headers?.map(h => h.work_package_link) ?? []).size} package
                                        {new Set(form.getValues("daily_progress_setup")?.work_headers?.map(h => h.work_package_link) ?? []).size !== 1 ? 's' : ''}
                                    </p>
                                )}
                            </div>
                        </div>
                    </ReviewSection>
                )}

                {/* Design Packages Section (only show if enabled) */}
                {form.getValues("design_packages_setup")?.enabled && (
                    <ReviewSection
                        title="Design Packages"
                        icon={PenTool}
                        onEdit={() => onNavigateToSection("packageSelection")}
                        iconColorClass="bg-pink-500/10 text-pink-600 dark:text-pink-400"
                        columns={1}
                    >
                        <div className="col-span-full space-y-4">
                            {/* Zone Configuration */}
                            <div>
                                <p className="text-xs font-medium text-gray-500 mb-2">
                                    Zone Configuration
                                    {form.getValues("design_packages_setup")?.zone_source === 'copy_from_progress' && (
                                        <span className="ml-2 text-xs text-blue-500 font-normal">(Copied from Daily Progress)</span>
                                    )}
                                </p>
                                <div className="flex flex-wrap gap-2">
                                    {form.getValues("design_packages_setup")?.zone_type === 'single' ? (
                                        <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium bg-gray-100 text-gray-700 border border-gray-200">
                                            Single Zone (Default)
                                        </span>
                                    ) : (
                                        <>
                                            {form.getValues("design_packages_setup")?.zones?.map((zone) => (
                                                <span
                                                    key={zone.zone_name}
                                                    className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium bg-pink-50 text-pink-700 border border-pink-200"
                                                >
                                                    {zone.zone_name}
                                                </span>
                                            ))}
                                        </>
                                    )}
                                </div>
                            </div>

                            {/* Selected Categories */}
                            <div>
                                <p className="text-xs font-medium text-gray-500 mb-2">Design Categories</p>
                                <div className="flex flex-wrap gap-2">
                                    {form.getValues("design_packages_setup")?.selected_categories?.length ? (
                                        form.getValues("design_packages_setup")?.selected_categories?.map((category) => (
                                            <span
                                                key={category}
                                                className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium bg-violet-50 text-violet-700 border border-violet-200"
                                            >
                                                {category}
                                            </span>
                                        ))
                                    ) : (
                                        <span className="text-xs text-gray-400 italic">No categories selected</span>
                                    )}
                                </div>
                                {(form.getValues("design_packages_setup")?.selected_categories?.length ?? 0) > 0 && (
                                    <p className="text-xs text-gray-400 mt-2">
                                        {form.getValues("design_packages_setup")?.selected_categories?.length ?? 0} categor
                                        {(form.getValues("design_packages_setup")?.selected_categories?.length ?? 0) !== 1 ? 'ies' : 'y'} selected for design tracking
                                    </p>
                                )}
                            </div>
                        </div>
                    </ReviewSection>
                )}

                {/* Critical PO Categories Section (only show if enabled) */}
                {form.getValues("critical_po_setup")?.enabled && (
                    <ReviewSection
                        title="Critical PO Categories"
                        icon={AlertCircle}
                        onEdit={() => onNavigateToSection("packageSelection")}
                        iconColorClass="bg-amber-500/10 text-amber-600 dark:text-amber-400"
                        columns={1}
                    >
                        <div className="col-span-full space-y-4">
                            {/* Selected Categories */}
                            <div>
                                <p className="text-xs font-medium text-gray-500 mb-2">Categories to Track</p>
                                <div className="flex flex-wrap gap-2">
                                    {form.getValues("critical_po_setup")?.selected_categories?.length ? (
                                        form.getValues("critical_po_setup")?.selected_categories?.map((category) => (
                                            <span
                                                key={category}
                                                className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200"
                                            >
                                                {category}
                                            </span>
                                        ))
                                    ) : (
                                        <span className="text-xs text-gray-400 italic">No categories selected</span>
                                    )}
                                </div>
                                {(form.getValues("critical_po_setup")?.selected_categories?.length ?? 0) > 0 && (
                                    <p className="text-xs text-gray-400 mt-2">
                                        {form.getValues("critical_po_setup")?.selected_categories?.length ?? 0} categor
                                        {(form.getValues("critical_po_setup")?.selected_categories?.length ?? 0) !== 1 ? 'ies' : 'y'} selected - tasks will be created with deadlines based on project start date
                                    </p>
                                )}
                            </div>
                        </div>
                    </ReviewSection>
                )}
            </ReviewContainer>

            {/* Navigation */}
            <div className="flex items-center justify-between pt-4 border-t border-gray-100">
                <Button
                    type="button"
                    variant="ghost"
                    onClick={onPrevious}
                    className="text-gray-600 hover:text-gray-900 hover:bg-gray-50"
                >
                    ← Previous
                </Button>
                {isSubmitting ? (
                    <ButtonLoading />
                ) : (
                    <Button
                        type="button"
                        onClick={onSubmit}
                        className="bg-emerald-500 hover:bg-emerald-600 text-white px-6 flex items-center gap-2"
                    >
                        <ListChecks className="h-4 w-4" />
                        Create Project
                    </Button>
                )}
            </div>
        </>
    );
};

export default ReviewStep;
