import { FuzzySearchSelect, FuzzyOptionType, TokenSearchConfig } from "@/components/ui/fuzzy-search-select";
import { Projects } from "@/types/NirmaanStack/Projects";
import { useFrappeGetDocList } from "frappe-react-sdk";
import { useEffect, useMemo, useState } from "react";
import { StylesConfig } from "react-select";

interface SelectOptions extends FuzzyOptionType {
    value: string;
    label: string;
    isDisabled?: boolean;
}

interface ProjectSelectProps {
    onChange: (selectedOption: SelectOptions | null) => void;
    universal?: boolean;
    all?: boolean;
    /** Enable portal rendering for dialogs/modals - dropdown renders in document.body */
    usePortal?: boolean;
    /** Custom style overrides */
    styles?: StylesConfig<SelectOptions, false>;
    /** Disable the select */
    disabled?: boolean;
    eligibleProjects?: Record<string, { po: number; itm: number }> | null;
}

// Token-based search config optimized for projects
// Searches both project name (label) and project code (value)
const projectSearchConfig: TokenSearchConfig = {
    searchFields: ['label', 'value'],
    minSearchLength: 1,
    partialMatch: true,
    minTokenLength: 1,
    fieldWeights: {
        'label': 2.0,   // Project name is primary
        'value': 1.5,   // Project code is secondary but still important
    },
    minTokenMatches: 1
};

export default function ProjectSelect({
    onChange,
    universal = true,
    all = false,
    usePortal = false,
    styles,
    disabled = false,
    eligibleProjects,
}: ProjectSelectProps) {
    // v3: only Won projects are selectable for operational work (the bid
    // dimension is the source of truth — covers both Tendering and Lost).
    const projectFilters: any[] = [["tendering_status", "=", "Won"]];

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

    const options: SelectOptions[] = useMemo(() => {
        const all = data?.map((item) => ({
            value: item.name,
            label: item.project_name,
        })) || [];
        if (eligibleProjects == null) return all;
        return all.map((o) => ({ ...o, isDisabled: !eligibleProjects[o.value] }));
    }, [data, eligibleProjects]);

    // Portal props for rendering dropdown in document.body (fixes clipping in dialogs)
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
            formatOptionLabel={(option, meta) => {
                const counts = eligibleProjects?.[option.value];
                // Colored count pills show only in the menu — the selected-value
                // chip stays a clean project name. PO=sky / ITM=purple mirrors
                // the Type-chip convention used elsewhere in the DN flow.
                if (meta.context === "value" || !counts) return option.label;
                if (counts.po <= 0 && counts.itm <= 0) return option.label;
                return (
                    <span className="flex items-center justify-between gap-2 w-full">
                        <span className="truncate">{option.label}</span>
                        <span className="flex items-center gap-1 whitespace-nowrap">
                            {counts.po > 0 && (
                                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-sky-50 text-sky-700 border border-sky-200">
                                    {counts.po} PO
                                </span>
                            )}
                            {counts.itm > 0 && (
                                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-purple-50 text-purple-700 border border-purple-200">
                                    {counts.itm} ITM
                                </span>
                            )}
                        </span>
                    </span>
                );
            }}
            {...portalProps}
        />
    );
}