import { FuzzySearchSelect, FuzzyOptionType, TokenSearchConfig } from "@/components/ui/fuzzy-search-select";
import { Vendors } from "@/types/NirmaanStack/Vendors";
import { useFrappeGetDocList } from "frappe-react-sdk";
import { useMemo } from "react";
import { StylesConfig } from "react-select";

/** The "no vendor on record" choice, mirroring the Project Expense dialogs.
 *
 *  Its value is a SENTINEL, never the empty string: react-select treats a falsy value as
 *  "nothing selected", so an empty-valued option cannot render as a chosen chip and the
 *  requester could not tell "Others" apart from an untouched field. The caller maps the
 *  sentinel back to "" before it reaches the API.
 */
export const OTHERS_VENDOR_VALUE = "OTHERS_EMPTY_SELECTION";

interface SelectOptions extends FuzzyOptionType {
    value: string;
    label: string;
    city?: string;
    state?: string;
}

interface VendorSelectProps {
    onChange: (selectedOption: SelectOptions | null) => void;
    /** Offer "Others (No Vendor)" at the top of the list. */
    withOthers?: boolean;
    /** Render the menu in document.body — REQUIRED inside a Dialog or it clips. */
    usePortal?: boolean;
    styles?: StylesConfig<SelectOptions, false>;
    disabled?: boolean;
    /** The selected vendor's ID (or the Others sentinel). The LABEL is resolved here from
     *  the fetched list — a caller holding only an id cannot know the vendor's name, and
     *  passing the id as the label renders the chip as `VEN-0042` instead of the vendor. */
    value?: string | null;
    placeholder?: string;
}

// Vendor name is what people search by; the id is a weaker secondary, exactly as
// `project-select` weights project name over project code.
const vendorSearchConfig: TokenSearchConfig = {
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

export default function VendorSelect({
    onChange,
    withOthers = true,
    usePortal = false,
    styles,
    disabled = false,
    value,
    placeholder = "Select a vendor or 'Others'...",
}: VendorSelectProps) {
    const { data, isLoading: loading, error } = useFrappeGetDocList<Vendors>("Vendors", {
        fields: ['name', 'vendor_name', 'vendor_city', 'vendor_state'],
        limit: 0,
        orderBy: { field: 'vendor_name', order: 'asc' },
    },
        // Stable SWR key so every VendorSelect in the app shares ONE cache entry instead of
        // each mount refetching the whole vendor list -- the same dedupe `ProjectSelect` does.
        "VendorSelect Vendors"
    );

    const options: SelectOptions[] = useMemo(() => {
        const vendors = data?.map((v) => ({
            value: v.name,
            label: v.vendor_name,
            city: v.vendor_city,
            state: v.vendor_state,
        })) || [];
        return withOthers
            ? [{ value: OTHERS_VENDOR_VALUE, label: "Others (No Vendor)" }, ...vendors]
            : vendors;
    }, [data, withOthers]);

    // Resolved from `options`, so the chip shows the vendor's NAME while the caller keeps
    // holding only the id. Unresolvable (still loading, or a vendor since removed) reads as
    // nothing selected rather than rendering a raw id.
    const selectedOption = useMemo(
        () => (value ? options.find((o) => o.value === value) ?? null : null),
        [value, options]
    );

    const portalProps = usePortal
        ? { menuPortalTarget: document.body, menuPosition: "fixed" as const }
        : {};

    if (error) return <h1>Error</h1>;
    return (
        <FuzzySearchSelect<SelectOptions, false>
            allOptions={options}
            tokenSearchConfig={vendorSearchConfig}
            isLoading={loading}
            isDisabled={disabled}
            value={selectedOption}
            onChange={onChange}
            placeholder={placeholder}
            isClearable
            styles={styles}
            formatOptionLabel={(option, meta) => {
                // City/state disambiguates same-named vendors while choosing, but the chosen
                // chip stays a clean name -- the `VendorsReactSelect` convention.
                if (meta.context === "value" || !option.city) return option.label;
                return (
                    <span className="flex items-center justify-between gap-2 w-full">
                        <span className="truncate">{option.label}</span>
                        <span className="text-[11px] text-muted-foreground whitespace-nowrap">
                            {[option.city, option.state].filter(Boolean).join(", ")}
                        </span>
                    </span>
                );
            }}
            {...portalProps}
        />
    );
}
