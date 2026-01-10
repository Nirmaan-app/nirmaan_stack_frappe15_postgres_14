import { Controller, UseFormReturn } from "react-hook-form";
import ReactSelect, { MultiValue, StylesConfig } from "react-select";
import { Button } from "@/components/ui/button";
import { ProjectFormValues, AssigneeOption } from "../schema";
import { ProjectFormData } from "../hooks/useProjectFormData";
import { Users, UserCheck, ShoppingCart, AlertCircle, Loader2 } from "lucide-react";

interface ProjectAssigneesStepProps {
    form: UseFormReturn<ProjectFormValues>;
    formData: ProjectFormData;
    onNext: () => void;
    onPrevious: () => void;
}

/**
 * Custom styles for react-select to match enterprise minimalist theme
 */
const selectStyles: StylesConfig<AssigneeOption, true> = {
    control: (base, state) => ({
        ...base,
        backgroundColor: "white",
        borderColor: state.isFocused ? "#0ea5e9" : "#e2e8f0",
        borderWidth: "1px",
        borderRadius: "0.5rem",
        minHeight: "44px",
        boxShadow: state.isFocused ? "0 0 0 3px rgba(14, 165, 233, 0.1)" : "none",
        transition: "all 0.15s ease",
        "&:hover": {
            borderColor: state.isFocused ? "#0ea5e9" : "#cbd5e1",
        },
    }),
    placeholder: (base) => ({
        ...base,
        color: "#94a3b8",
        fontSize: "0.875rem",
    }),
    input: (base) => ({
        ...base,
        color: "#1e293b",
        fontSize: "0.875rem",
    }),
    multiValue: (base) => ({
        ...base,
        backgroundColor: "#f0f9ff",
        borderRadius: "0.375rem",
        border: "1px solid #bae6fd",
    }),
    multiValueLabel: (base) => ({
        ...base,
        color: "#0369a1",
        fontSize: "0.8125rem",
        fontWeight: 500,
        padding: "2px 6px",
    }),
    multiValueRemove: (base) => ({
        ...base,
        color: "#0ea5e9",
        borderRadius: "0 0.375rem 0.375rem 0",
        "&:hover": {
            backgroundColor: "#0ea5e9",
            color: "white",
        },
    }),
    menu: (base) => ({
        ...base,
        borderRadius: "0.5rem",
        boxShadow: "0 10px 40px -10px rgba(0, 0, 0, 0.15)",
        border: "1px solid #e2e8f0",
        overflow: "hidden",
        zIndex: 50,
    }),
    menuList: (base) => ({
        ...base,
        padding: "4px",
    }),
    option: (base, state) => ({
        ...base,
        backgroundColor: state.isSelected
            ? "#0ea5e9"
            : state.isFocused
            ? "#f0f9ff"
            : "transparent",
        color: state.isSelected ? "white" : "#1e293b",
        fontSize: "0.875rem",
        padding: "10px 12px",
        borderRadius: "0.375rem",
        cursor: "pointer",
        transition: "all 0.1s ease",
        "&:active": {
            backgroundColor: state.isSelected ? "#0ea5e9" : "#e0f2fe",
        },
    }),
    noOptionsMessage: (base) => ({
        ...base,
        color: "#64748b",
        fontSize: "0.875rem",
        padding: "12px",
    }),
    loadingMessage: (base) => ({
        ...base,
        color: "#64748b",
        fontSize: "0.875rem",
    }),
};

/**
 * Assignee field configuration
 */
interface AssigneeFieldConfig {
    name: "assignees.project_leads" | "assignees.project_managers" | "assignees.procurement_executives";
    label: string;
    description: string;
    icon: React.ReactNode;
    options: AssigneeOption[];
    placeholder: string;
}

export const ProjectAssigneesStep: React.FC<ProjectAssigneesStepProps> = ({
    form,
    formData,
    onNext,
    onPrevious,
}) => {
    const {
        projectLeadOptions,
        projectManagerOptions,
        procurementLeadOptions,
        usersLoading,
        usersError,
    } = formData;

    const fields: AssigneeFieldConfig[] = [
        {
            name: "assignees.project_leads",
            label: "Project Leads",
            description: "Select team members who will lead project execution and coordination",
            icon: <Users className="h-5 w-5" />,
            options: projectLeadOptions,
            placeholder: "Select project leads...",
        },
        {
            name: "assignees.project_managers",
            label: "Project Managers",
            description: "Select managers responsible for day-to-day project operations",
            icon: <UserCheck className="h-5 w-5" />,
            options: projectManagerOptions,
            placeholder: "Select project managers...",
        },
        {
            name: "assignees.procurement_executives",
            label: "Procurement Executives",
            description: "Select executives handling material procurement and vendor management",
            icon: <ShoppingCart className="h-5 w-5" />,
            options: procurementLeadOptions,
            placeholder: "Select procurement executives...",
        },
    ];

    // Error state
    if (usersError) {
        return (
            <div className="flex flex-col items-center justify-center py-16 px-4">
                <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center mb-4">
                    <AlertCircle className="h-8 w-8 text-red-500" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                    Unable to Load Team Members
                </h3>
                <p className="text-sm text-gray-500 text-center max-w-md mb-6">
                    {usersError.message || "An error occurred while fetching team members. Please try again."}
                </p>
                <Button variant="outline" onClick={onPrevious}>
                    Go Back
                </Button>
            </div>
        );
    }

    // Loading state
    if (usersLoading) {
        return (
            <div className="flex flex-col items-center justify-center py-16">
                <Loader2 className="h-10 w-10 text-sky-500 animate-spin mb-4" />
                <p className="text-sm text-gray-500">Loading team members...</p>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Header Section */}
            <div className="border-b border-gray-100 pb-4">
                <div className="flex items-center gap-3 mb-2">
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-sky-500 to-sky-600 flex items-center justify-center shadow-sm">
                        <Users className="h-4 w-4 text-white" />
                    </div>
                    <h2 className="text-lg font-semibold text-gray-900">
                        Team Assignment
                    </h2>
                </div>
                <p className="text-sm text-gray-500 ml-11">
                    Assign team members to this project. You can select multiple people for each role.
                    <span className="text-gray-400 ml-1">(Optional)</span>
                </p>
            </div>

            {/* Assignee Fields */}
            <div className="space-y-6">
                {fields.map((field) => (
                    <div
                        key={field.name}
                        className="group relative bg-white rounded-xl border border-gray-100 p-5 transition-all duration-200 hover:border-gray-200 hover:shadow-sm"
                    >
                        {/* Field Header */}
                        <div className="flex items-start gap-3 mb-4">
                            <div className="w-10 h-10 rounded-lg bg-gray-50 border border-gray-100 flex items-center justify-center text-gray-400 group-hover:text-sky-500 group-hover:bg-sky-50 group-hover:border-sky-100 transition-colors duration-200">
                                {field.icon}
                            </div>
                            <div className="flex-1 min-w-0">
                                <label className="block text-sm font-medium text-gray-900 mb-0.5">
                                    {field.label}
                                </label>
                                <p className="text-xs text-gray-500 leading-relaxed">
                                    {field.description}
                                </p>
                            </div>
                            {/* Count badge */}
                            <Controller
                                name={field.name}
                                control={form.control}
                                render={({ field: controllerField }) => (
                                    <div className="flex-shrink-0">
                                        {controllerField.value && (controllerField.value as AssigneeOption[]).length > 0 && (
                                            <span className="inline-flex items-center justify-center min-w-[24px] h-6 px-2 text-xs font-semibold text-sky-700 bg-sky-100 rounded-full">
                                                {(controllerField.value as AssigneeOption[]).length}
                                            </span>
                                        )}
                                    </div>
                                )}
                            />
                        </div>

                        {/* Select Input */}
                        <Controller
                            name={field.name}
                            control={form.control}
                            render={({ field: controllerField }) => (
                                <ReactSelect<AssigneeOption, true>
                                    isMulti
                                    options={field.options}
                                    value={controllerField.value as AssigneeOption[] || []}
                                    onChange={(newValue: MultiValue<AssigneeOption>) => {
                                        controllerField.onChange(newValue as AssigneeOption[]);
                                    }}
                                    placeholder={field.placeholder}
                                    styles={selectStyles}
                                    isClearable
                                    isSearchable
                                    noOptionsMessage={() => "No team members available"}
                                    classNamePrefix="assignee-select"
                                />
                            )}
                        />

                        {/* Available count hint */}
                        <p className="mt-2 text-xs text-gray-400">
                            {field.options.length} {field.options.length === 1 ? "member" : "members"} available
                        </p>
                    </div>
                ))}
            </div>

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
                <Button
                    type="button"
                    onClick={onNext}
                    className="bg-sky-500 hover:bg-sky-600 text-white px-6"
                >
                    Continue →
                </Button>
            </div>
        </div>
    );
};

export default ProjectAssigneesStep;
