// import * as SelectPrimitive from "@radix-ui/react-select";
// import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
// import React, { useMemo } from 'react'; // <-- ADDED: useMemo for optimization
// import { useFrappeGetDocList } from "frappe-react-sdk"; // <-- ADDED: Frappe Hook



// interface NirmaanItemUnit {
//     name: string;      // The DocName (can be ignored)
//     unit_abb: string;  // The field containing the UOM abbreviation (e.g., "ROLL", "KGS")
// }

// interface SelectUnitProps extends SelectPrimitive.SelectProps {
//     value: string;
//     onChange: (value: string) => void;
//     className?: string;
// }

// // export const UnitOptions : {value: string, label: string}[] = [
// //     // { value: "PCS", label: "PCS" },
// //     // {value : "PKT", label : "PKT"},
// //     { value: "BOX", label: "BOX" },
// //     { value: "ROLL", label: "ROLL" },
// //     {value : "LTH", label : "LTH"},
// //     {value : "MTR", label : "MTR"},
// //     { value: "NOS", label: "NOS" },
// //     { value: "KGS", label: "KGS" },
// //     { value: "PAIRS", label: "PAIRS" },
// //     { value: "PACKS", label: "PACKS" },
// //     { value: "DRUM", label: "DRUM" },
// //     { value: "SQMTR", label: "SQMTR" },
// //     { value: "LTR", label: "LTR" },
// //     { value: "BUNDLE", label: "BUNDLE" },
// //     { value: "FEET", label: "FEET" },
// //     { value: "LOT", label: "LOT" },
// //     { value: "SQFT", label: "SQFT" },
// //     { value: "RFT", label: "RFT" },
// //   ]



// export const SelectUnit : React.FC<SelectUnitProps> = ({ value, onChange, className, ...rest }) => {
//    const { data: rawUnits, isLoading } = useFrappeGetDocList<NirmaanItemUnit>(
//         "Nirmaan Item Units", // <-- YOUR DOCTYPE NAME
//         {
//             fields: ["unit_abb"], // Only fetch the abbreviation field
//             limit: 0, // Fetch all units
//             orderBy: { field: 'unit_abb', order: 'asc' }
//         },
//         "all_nirmaan_units" // Unique SWR key for caching
//     );
//     const NirmaanunitOptions = useMemo(() => {
//         return rawUnits
//             ?.filter(u => u.unit_abb) // Filter out null/empty abbreviations
//             .map(unit => ({
//                 value: unit.unit_abb,
//                 label: unit.unit_abb // Use the same value for label
//             })) || [];
//     }, [rawUnits]);


//     return (
//         <Select
//             value={value}
//             onValueChange={(e) => onChange(e)}
//             {...rest}
//         >
//           <SelectTrigger>
//             <SelectValue className={className} placeholder="Select Unit" />
//           </SelectTrigger>
//           <SelectContent>
//             {NirmaanunitOptions.map((option) => (
//                 <SelectItem key={option.value} value={option.value}>
//                     {option.label}
//                 </SelectItem>
//             ))}
//           </SelectContent>
//         </Select>
//     );
// };


import * as SelectPrimitive from "@radix-ui/react-select";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import React, { useMemo } from 'react'; // <-- ADDED: useMemo for optimization
import { useFrappeGetDocList } from "frappe-react-sdk"; // <-- ADDED: Frappe Hook

// --- NEW: Interface for the DocType Data ---
// Assuming your DocType is named 'Nirmaan Item Units' and has a field 'unit_abb'
interface NirmaanItemUnit {
    name: string;      // The DocName (can be ignored)
    unit_abb: string;  // The field containing the UOM abbreviation (e.g., "ROLL", "KGS")
}

interface SelectUnitProps extends SelectPrimitive.SelectProps {
    value: string;
    onChange: (value: string) => void;
    className?: string;
}

// --- OPTIONAL: Define a custom hook if you want to reuse the options fetch globally ---
export const useNirmaanUnitOptions = () => {
    const { data: rawUnits, isunitOptionsLoading } = useFrappeGetDocList<NirmaanItemUnit>(
        "Nirmaan Item Units", // <-- YOUR DOCTYPE NAME
        {
            fields: ["unit_abb"], // Only fetch the abbreviation field
            limit: 0, // Fetch all units
            orderBy: { field: 'unit_abb', order: 'asc' }
        },
        "all_nirmaan_units" // Unique SWR key for caching
    );

    const UnitOptions = useMemo(() => {
        return rawUnits
            ?.filter(u => u.unit_abb) // Filter out null/empty abbreviations
            .map(unit => ({
                value: unit.unit_abb,
                label: unit.unit_abb // Use the same value for label
            })) || [];
    }, [rawUnits]);

    return { UnitOptions, isunitOptionsLoading };
};
// --- END OPTIONAL HOOK ---

export const SelectUnit : React.FC<SelectUnitProps> = ({ value, onChange, className, ...rest }) => {

    // --- USE THE HOOK/LOGIC HERE ---
    const { UnitOptions, isunitOptionsLoading } = useNirmaanUnitOptions();
    // -----------------------------

    return (
        <Select
            value={value}
            onValueChange={(e) => onChange(e)}
            disabled={isunitOptionsLoading || rest.disabled} // Disable while loading data
            {...rest}
        >
          <SelectTrigger>
            <SelectValue className={className} placeholder={isunitOptionsLoading ? "Loading Units..." : "Select Unit"} />
          </SelectTrigger>
          <SelectContent>
            {UnitOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                    {option.label}
                </SelectItem>
            ))}
          </SelectContent>
        </Select>
    );
};