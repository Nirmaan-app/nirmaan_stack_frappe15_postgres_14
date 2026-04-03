// src/components/project-milestone-select.tsx
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

    // Filters for projects: must have milestone tracking enabled and not be in Completed status
    const projectMilestoneFilters: any[] = [
        ["status", "!=", "Cancelled"],
        ["enable_project_milestone_tracking", "=", 1] // Projects must have milestone tracking enabled
    ];

    const { data: data, isLoading: loading, error: error } = useFrappeGetDocList<any>("Projects", {
        fields: ['name', 'project_name', 'project_address', "project_manager", "status", "enable_project_milestone_tracking", "disabled_dpr", "disabled_dpr_date", "status"],
        filters: projectMilestoneFilters, // Always apply these filters
        limit: 1000,
        orderBy: { field: 'creation', order: 'desc' },
    });

    const [selectedOption, setSelectedOption] = useState<SelectOptions | null>(null);

    // Apply manual filtering for deactivated DPR
    const filteredData = useMemo(() => {
        if (!data) return [];
        const now = new Date();
        const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

        return data.filter(project => {
            if (project.disabled_dpr) {
                // If disabled_dpr_date is missing, we treat it as disabled immediately
                if (!project.disabled_dpr_date) return false;
                return today < project.disabled_dpr_date;
            }
            return true;
        });
    }, [data]);

    useEffect(() => {
        if (filteredData && universal) {
            const currOptions = filteredData.map((item) => ({ value: item.name, label: item.project_name }));

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
    }, [filteredData, universal, onChange]);

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

    const options = useMemo(() => filteredData?.map((item) => ({
        value: item.name,
        label: item.project_name,
    })) || [], [filteredData]);

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