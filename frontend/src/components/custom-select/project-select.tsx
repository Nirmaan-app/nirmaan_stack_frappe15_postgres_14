import { Projects } from "@/types/NirmaanStack/Projects";
import { useFrappeGetDocList } from "frappe-react-sdk";
import { useEffect, useMemo, useState } from "react";
import ReactSelect from "react-select";

interface SelectOptions {
    value: string,
    label: string
}

interface ProjectSelectProps {
    onChange: (selectedOption: SelectOptions | null) => void
    universal?: boolean
    all?: boolean
}

export default function ProjectSelect({ onChange, universal = true, all = false }: ProjectSelectProps) {

    // First build the filters array dynamically
    const projectFilters = [["status", "not in", ["Completed", "Halted"]]];



    const { data: data, isLoading: loading, error: error } = useFrappeGetDocList<Projects>("Projects", {
        fields: ['name', 'project_name', 'project_address', "project_manager", "status"],
        filters: all ? undefined : projectFilters,
        limit: 1000,
        orderBy: { field: 'creation', order: 'desc' },
    });

    const [selectedOption, setSelectedOption] = useState<SelectOptions | null>(null);

    useEffect(() => {
        if (data && universal) {
            let currOptions = data.map((item) => {
                return ({ value: item.name, label: item.project_name })
            })
            // Set initial selected option from sessionStorage
            const savedProject = sessionStorage.getItem('selectedProject');
            if (savedProject) {
                const savedProjectObj = JSON.parse(savedProject);
                const initialOption = currOptions.find(option => option.value === savedProjectObj);
                setSelectedOption(initialOption || null);
                if (initialOption) {
                    onChange(initialOption);
                }
            }
        }
    }, [data, universal]);

    const handleChange = (selectedOption: SelectOptions | null) => {
        setSelectedOption(selectedOption);
        onChange(selectedOption);
    };

    const options = useMemo(() => data?.map((item) => ({
        value: item.name,
        label: item.project_name,
    })) || [], [data]);

    if (error) return <h1>Error</h1>;
    return (
        <ReactSelect
            options={options}
            isLoading={loading}
            value={selectedOption}
            onChange={handleChange}
            placeholder="Select Project"
            isClearable
            onMenuOpen={() => handleChange(null)}
        ></ReactSelect>
    );
}