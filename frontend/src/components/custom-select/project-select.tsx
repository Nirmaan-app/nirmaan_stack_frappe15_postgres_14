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
    });

    const [options, setOptions] = useState<SelectOptions[]>([]);

    useEffect(() => {
        if (data) {
            let currOptions = data.map((item) => {
                return ({ value: item.name, label: item.project_name })
            })
            setOptions(currOptions);
        }
    }, [data]);

    if (loading) return <h1>Loading</h1>;
    if (error) return <h1>Error</h1>;
    return (
        <ReactSelect options={options} onChange={onChange} placeholder="Select Project"></ReactSelect>
    );
}