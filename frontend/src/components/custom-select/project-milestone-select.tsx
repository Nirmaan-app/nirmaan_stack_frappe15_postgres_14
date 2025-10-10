// src/components/project-milestone-select.tsx
import { Projects } from "@/types/NirmaanStack/Projects";
import { useFrappeGetDocList } from "frappe-react-sdk";
import { useEffect, useMemo, useState } from "react";
import ReactSelect from "react-select";

interface SelectOptions {
    value: string,
    label: string
}

interface ProjectMilestoneSelectProps {
    onChange: (selectedOption: SelectOptions | null) => void;
    universal?: boolean; // If true, saves and loads selection from sessionStorage
}

export default function ProjectMilestoneSelect({ onChange, universal = true }: ProjectMilestoneSelectProps) {

    // Filters for projects: must have milestone tracking enabled and not be in Completed/Halted status
    const projectMilestoneFilters: any[] = [
        ["status", "not in", ["Completed", "Halted"]],
        ["enable_project_milestone_tracking", "=", 1] // Projects must have milestone tracking enabled
    ];

    const { data: data, isLoading: loading, error: error } = useFrappeGetDocList<Projects>("Projects", {
        fields: ['name', 'project_name', 'project_address', "project_manager", "status", "enable_project_milestone_tracking"],
        filters: projectMilestoneFilters, // Always apply these filters
        limit: 0,
        orderBy: { field: 'creation', order: 'desc' },
    });

    const [selectedOption, setSelectedOption] = useState<SelectOptions | null>(null);

    useEffect(() => {
        if (data && universal) {
            const currOptions = data.map((item) => ({ value: item.name, label: item.project_name }));

            // Set initial selected option from sessionStorage if universal tracking is enabled
            const savedProject = sessionStorage.getItem('selectedProjectForMilestones'); // Unique key for this selector
            if (savedProject) {
                try {
                    const savedProjectValue = JSON.parse(savedProject);
                    const initialOption = currOptions.find(option => option.value === savedProjectValue);
                    setSelectedOption(initialOption || null);
                    if (initialOption) {
                        onChange(initialOption);
                    }
                } catch (e) {
                    console.error("Failed to parse saved project from sessionStorage for milestones:", e);
                    sessionStorage.removeItem('selectedProjectForMilestones');
                }
            }
        }
    }, [data, universal, onChange]);

    const handleChange = (selectedOption: SelectOptions | null) => {
        setSelectedOption(selectedOption);
        onChange(selectedOption);

        // Persist to sessionStorage if it's a universal project selector
        if (universal) {
            if (selectedOption) {
                sessionStorage.setItem('selectedProjectForMilestones', JSON.stringify(selectedOption.value));
            } else {
                sessionStorage.removeItem('selectedProjectForMilestones');
            }
        }
    };

    const options = useMemo(() => data?.map((item) => ({
        value: item.name,
        label: item.project_name,
    })) || [], [data]);

    if (error) return <h1 className="text-red-500">Error loading projects.</h1>; // More descriptive error message

    return (
        <ReactSelect
            options={options}
            isLoading={loading}
            value={selectedOption}
            onChange={handleChange}
            placeholder="Select Project" // Updated placeholder
            isClearable
        ></ReactSelect>
    );
}