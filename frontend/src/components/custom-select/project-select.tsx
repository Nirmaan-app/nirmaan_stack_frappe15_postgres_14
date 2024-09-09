import { useFrappeGetDocList } from "frappe-react-sdk";
import { useEffect, useState } from "react";
import ReactSelect from "react-select";

interface SelectOptions {
    value: string,
    label: string
}

interface ProjectSelectProps {
    //category: string,
    onChange: (selectedOption: SelectOptions | null) => void
}

export default function ProjectSelect({ onChange }: ProjectSelectProps) {

    const { data: data, isLoading: loading, error: error } = useFrappeGetDocList("Projects", {
        fields: ['name', 'project_name', 'project_address', "project_manager"],
        limit: 1000
    });

    const [options, setOptions] = useState<SelectOptions[]>([]);

    const [selectedOption, setSelectedOption] = useState<SelectOptions | null>(null);

    useEffect(() => {
        if (data) {
            let currOptions = data.map((item) => {
                return ({ value: item.name, label: item.project_name })
            })
            setOptions(currOptions);
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
    }, [data, onChange]);

    const handleChange = (selectedOption: SelectOptions | null) => {
        setSelectedOption(selectedOption);
        onChange(selectedOption);
    };

    if (loading) return <h1>Loading</h1>;
    if (error) return <h1>Error</h1>;
    return (
        <ReactSelect options={options} value={selectedOption} onChange={handleChange} placeholder="Select Project"></ReactSelect>
    );
}