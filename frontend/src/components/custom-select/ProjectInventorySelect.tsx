import { FuzzySearchSelect, FuzzyOptionType, TokenSearchConfig } from "@/components/ui/fuzzy-search-select";
import { Projects } from "@/types/NirmaanStack/Projects";
import { useFrappeGetDocList } from "frappe-react-sdk";
import { useEffect, useMemo, useState } from "react";
import { StylesConfig } from "react-select";

interface SelectOptions extends FuzzyOptionType {
    value: string;
    label: string;
}

interface ProjectInventorySelectProps {
    onChange: (selectedOption: SelectOptions | null) => void;
    /** Whether to show all projects regardless of status (useful for admins) */
    all?: boolean;
    /** Enable portal rendering for dialogs/modals */
    usePortal?: boolean;
    /** Custom style overrides */
    styles?: StylesConfig<SelectOptions, false>;
    /** Disable the select */
    disabled?: boolean;
}

const projectSearchConfig: TokenSearchConfig = {
    searchFields: ['label', 'value'],
    minSearchLength: 1,
    partialMatch: true,
    minTokenLength: 1,
    fieldWeights: {
        'label': 2.0,
        'value': 1.5,
    },
    minTokenMatches: 1
};

export default function ProjectInventorySelect({
    onChange,
    all = false,
    usePortal = false,
    styles,
    disabled = false,
}: ProjectInventorySelectProps) {
    // Fetch all potentially relevant projects
    // We filter Cancelled/Completed projects but allow Halted/Handover to be handled by deactivation logic
    const { data: data, isLoading: loading, error: error } = useFrappeGetDocList<Projects>("Projects", {
        fields: ['name', 'project_name', 'project_address', "project_manager", "status", "disabled_inventory", "disabled_inventory_date"],
        filters: all ? undefined : [["status", "not in", ["Cancelled"]]],
        limit: 1000,
        orderBy: { field: 'creation', order: 'desc' },
    });

    const [selectedOption, setSelectedOption] = useState<SelectOptions | null>(null);

    const today = new Date().toISOString().split('T')[0];

    useEffect(() => {
        if (data) {
            let currOptions = data
                .filter(item => {
                    // Modular Inventory Deactivation Logic:
                    // Hide if disabled_inventory is 1 AND (disabled_inventory_date has passed OR is today)
                    if (item.disabled_inventory === 1) {
                        const deactiveDate = item.disabled_inventory_date;
                        if (deactiveDate && deactiveDate <= today) {
                            return false;
                        }
                    }
                    // Also hide Completed projects by default unless 'all' is true
                    if (!all && item.status === "Completed") return false;
                    
                    return true;
                })
                .map((item) => ({ value: item.name, label: item.project_name }));

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
    }, [data, all, today]);

    const handleChange = (selectedOption: SelectOptions | null) => {
        setSelectedOption(selectedOption);
        onChange(selectedOption);
    };

    const options: SelectOptions[] = useMemo(() => {
        if (!data) return [];
        return data
            .filter(item => {
                if (item.disabled_inventory === 1) {
                    const deactiveDate = item.disabled_inventory_date;
                    if (deactiveDate && deactiveDate <= today) {
                        return false;
                    }
                }
                if (!all && item.status === "Completed") return false;
                return true;
            })
            .map((item) => ({
                value: item.name,
                label: item.project_name,
            }));
    }, [data, all, today]);

    const portalProps = usePortal
        ? {
              menuPortalTarget: document.body,
              menuPosition: "fixed" as const,
          }
        : {};

    if (error) return <h1>Error</h1>;
    return (
        <FuzzySearchSelect<SelectOptions, false>
            allOptions={options}
            tokenSearchConfig={projectSearchConfig}
            isLoading={loading}
            isDisabled={disabled}
            value={selectedOption}
            onChange={handleChange}
            placeholder="Select Project"
            isClearable
            onMenuOpen={() => handleChange(null)}
            styles={styles}
            {...portalProps}
        />
    );
}
