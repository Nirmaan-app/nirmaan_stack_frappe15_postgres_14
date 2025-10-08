import React, { useState, useEffect, useMemo, useCallback } from 'react';
import ReactSelect, {
    Props as SelectProps, // Import Props type from react-select
    SingleValue,
    MultiValue,
    InputActionMeta,
    components,
    MenuListProps
} from 'react-select';
import Fuse, { FuseResult, IFuseOptions } from 'fuse.js';
import { debounce } from 'lodash';

// Generic Option type for ReactSelect
export interface FuzzyOptionType {
    value: any; // Can be string, number, or object
    label: string;
    [key: string]: any; // Allow other properties for data an_stackd Fuse.js keys
}

// Props for our custom component
// Extends ReactSelect's props to allow passing them through
interface FuzzySearchSelectProps<T extends FuzzyOptionType, IsMulti extends boolean = false>
    extends Omit<SelectProps<T, IsMulti>, 'options' | 'filterOption' | 'onInputChange' | 'onChange'> {
    
    allOptions: T[]; // The complete, unfiltered list of options
    fuseOptions: IFuseOptions<T>; // Configuration for Fuse.js
    debounceDelay?: number;
    
    // Override onChange to work with our internal state and external callback
    onChange: (selectedOption: IsMulti extends true ? MultiValue<T> : SingleValue<T>) => void;
    
    // Optional: If parent needs to know the raw input value from the select's search box
    onSearchInputChange?: (inputValue: string) => void;

    // Optional: For rendering custom elements in the menu list (e.g., "Create New" button)
    // This function receives props similar to react-select's MenuList component
    // and should render props.children to display the options.
    customMenuListComponent?: React.ComponentType<MenuListProps<T, IsMulti>>;
    // Props to pass to customMenuListComponent (like onAddItemClick)
    customMenuListProps?: Record<string, any>;
}

export function FuzzySearchSelect<T extends FuzzyOptionType, IsMulti extends boolean = false>({
    allOptions,
    fuseOptions,
    debounceDelay = 300,
    onChange,
    onSearchInputChange,
    customMenuListComponent,
    customMenuListProps,
    value, // Value prop from react-select, managed by parent
    ...restSelectProps // Rest of the react-select props
}: FuzzySearchSelectProps<T, IsMulti>) {

    const [inputValue, setInputValue] = useState('');
    const [debouncedInputValue, setDebouncedInputValue] = useState('');
    const [filteredOptions, setFilteredOptions] = useState<T[]>(allOptions);

    // Memoize Fuse instance
    const fuseInstance = useMemo(() => {
        if (!allOptions || allOptions.length === 0) return null;
        return new Fuse(allOptions, fuseOptions);
    }, [allOptions, fuseOptions]); // Recreate if options or fuse config change

    // Debounce the input value for searching
    const debouncedSetSearch = useCallback(
        debounce((term: string) => {
            setDebouncedInputValue(term);
        }, debounceDelay),
        [debounceDelay]
    );

    useEffect(() => {
        debouncedSetSearch(inputValue);
        return () => debouncedSetSearch.cancel();
    }, [inputValue, debouncedSetSearch]);

    // Perform search when debounced input value changes
    useEffect(() => {
        if (!debouncedInputValue.trim() || !fuseInstance) {
            setFilteredOptions(allOptions); // Show all if no input or Fuse not ready
            return;
        }
        const results = fuseInstance.search(debouncedInputValue);
        setFilteredOptions(results.map(result => result.item));
    }, [debouncedInputValue, fuseInstance, allOptions]);

    // Handle input change from ReactSelect
    const handleInputChange = (newValue: string, actionMeta: InputActionMeta) => {
        // We only want to update state on actual input typing
        if (actionMeta.action === 'input-change') {
            setInputValue(newValue);
            onSearchInputChange?.(newValue); // Notify parent if needed
        } else if (actionMeta.action === 'input-blur' && newValue) {
             // If input is blurred with content, keep it for debouncing
            setInputValue(newValue);
            onSearchInputChange?.(newValue);
        }
        // For 'set-value' (when an option is selected) or 'menu-close', don't necessarily clear input
        // This allows the selected value to remain visible, and the parent can control clearing if needed
    };

    const handleSelectChange = (
        selectedOption: IsMulti extends true ? MultiValue<T> : SingleValue<T>
    ) => {
        onChange(selectedOption); // Call parent's onChange
        // Optionally, clear the input field after selection, or let parent control this
        setInputValue('');
    };
    
    const MappedCustomMenuList = customMenuListComponent
        ? (props: MenuListProps<T, IsMulti>) => {
              const CustomComponent = customMenuListComponent;
              return <CustomComponent {...props} {...customMenuListProps} />;
          }
        : components.MenuList;


    return (
        <ReactSelect<T, IsMulti>
            value={value} // Controlled by parent
            options={filteredOptions}
            onInputChange={handleInputChange}
            onChange={handleSelectChange}
            filterOption={null} // IMPORTANT: Disable internal filtering
            components={{ MenuList: MappedCustomMenuList }}
            // Pass through any other react-select props
            {...restSelectProps}
        />
    );
}



// // Approach A:fuse

// import React, { useState, useEffect, useMemo, useCallback } from 'react';
// import ReactSelect, {
//     Props as SelectProps,
//     SingleValue,
//     MultiValue,
//     InputActionMeta,
//     components,
//     MenuListProps
// } from 'react-select';
// import Fuse, { FuseResult, IFuseOptions } from 'fuse.js';
// import { debounce } from 'lodash';

// // Generic Option type for ReactSelect
// export interface FuzzyOptionType {
//     value: any;
//     label: string;
//     [key: string]: any;
// }

// // Props for our custom component
// interface FuzzySearchSelectProps<T extends FuzzyOptionType, IsMulti extends boolean = false>
//     extends Omit<SelectProps<T, IsMulti>, 'options' | 'filterOption' | 'onInputChange' | 'onChange'> {
    
//     allOptions: T[];
//     fuseOptions: IFuseOptions<T>;
//     debounceDelay?: number;
//     onChange: (selectedOption: IsMulti extends true ? MultiValue<T> : SingleValue<T>) => void;
//     onSearchInputChange?: (inputValue: string) => void;
//     customMenuListComponent?: React.ComponentType<MenuListProps<T, IsMulti>>;
//     customMenuListProps?: Record<string, any>;
// }

// // ============================================================================
// // CHANGE 1: Enhanced default Fuse.js options for position-independent matching
// // ============================================================================
// const getEnhancedFuseOptions = <T extends FuzzyOptionType>(
//     userOptions: IFuseOptions<T>
// ): IFuseOptions<T> => {
//     return {
//         // User options first (can be overridden)
//         ...userOptions,
        
//         // ENHANCED OPTIONS - These improve position-independent matching
//         threshold: userOptions.threshold ?? 0.4, // Lower = stricter (0.0 exact, 1.0 match anything)
//         // Default was 0.6, we set to 0.4 for better relevance
        
//         ignoreLocation: true, // CRITICAL: Ignore where in the string the match is found
//         // This allows "150mm" to match regardless of position
        
//         distance: userOptions.distance ?? 1000, // How far from start to search (irrelevant with ignoreLocation)
        
//         minMatchCharLength: userOptions.minMatchCharLength ?? 2, // Minimum characters to match
        
//         // Search in all specified keys
//         keys: userOptions.keys ?? ['label'], // Default to searching in 'label' only
        
//         // Include score and matches for debugging/ranking
//         includeScore: true,
//         includeMatches: true,
        
//         // IMPORTANT: These options improve multi-word matching
//         useExtendedSearch: false, // Set to true if you want to use special operators like 'word1 'word2
        
//         // For better multi-token matching, we handle it in the search logic below
//         shouldSort: true, // Sort by best match
        
//         //FieldNormWeight affects how field length impacts scoring
//         // Lower value = length matters less
//         // Higher value = prioritizes matches in shorter fields
//         // Default is 1, keep it balanced
//     };
// };

// export function FuzzySearchSelect<T extends FuzzyOptionType, IsMulti extends boolean = false>({
//     allOptions,
//     fuseOptions,
//     debounceDelay = 300,
//     onChange,
//     onSearchInputChange,
//     customMenuListComponent,
//     customMenuListProps,
//     value,
//     ...restSelectProps
// }: FuzzySearchSelectProps<T, IsMulti>) {

//     const [inputValue, setInputValue] = useState('');
//     const [debouncedInputValue, setDebouncedInputValue] = useState('');
//     const [filteredOptions, setFilteredOptions] = useState<T[]>(allOptions);

//     // ============================================================================
//     // CHANGE 2: Apply enhanced Fuse.js options
//     // ============================================================================
//     const fuseInstance = useMemo(() => {
//         if (!allOptions || allOptions.length === 0) return null;
//         const enhancedOptions = getEnhancedFuseOptions(fuseOptions);
//         return new Fuse(allOptions, enhancedOptions);
//     }, [allOptions, fuseOptions]);

//     const debouncedSetSearch = useCallback(
//         debounce((term: string) => {
//             setDebouncedInputValue(term);
//         }, debounceDelay),
//         [debounceDelay]
//     );

//     useEffect(() => {
//         debouncedSetSearch(inputValue);
//         return () => debouncedSetSearch.cancel();
//     }, [inputValue, debouncedSetSearch]);

//     // ============================================================================
//     // CHANGE 3: Enhanced search logic with multi-token support
//     // ============================================================================
//     useEffect(() => {
//         if (!debouncedInputValue.trim() || !fuseInstance) {
//             setFilteredOptions(allOptions);
//             return;
//         }

//         // Split input into tokens for multi-word search
//         const searchTokens = debouncedInputValue
//             .trim()
//             .toLowerCase()
//             .split(/\s+/) // Split by whitespace
//             .filter(token => token.length > 0);

//         if (searchTokens.length === 0) {
//             setFilteredOptions(allOptions);
//             return;
//         }

//         // If single token, use Fuse.js directly
//         if (searchTokens.length === 1) {
//             const results = fuseInstance.search(debouncedInputValue);
//             setFilteredOptions(results.map(result => result.item));
//             return;
//         }

//         // MULTI-TOKEN SEARCH
//         // For each token, get matching items, then find intersection
//         const tokenResults = searchTokens.map(token => {
//             const results = fuseInstance.search(token);
//             return new Set(results.map(r => r.item));
//         });

//         // Find items that match ALL tokens (intersection)
//         const matchingItems = allOptions.filter(option => {
//             return tokenResults.every(resultSet => resultSet.has(option));
//         });

//         // Sort by relevance using full search string
//         if (matchingItems.length > 0) {
//             const fullSearchResults = fuseInstance.search(debouncedInputValue);
//             const scoreMap = new Map(
//                 fullSearchResults.map(r => [r.item, r.score ?? 1])
//             );
            
//             matchingItems.sort((a, b) => {
//                 const scoreA = scoreMap.get(a) ?? 1;
//                 const scoreB = scoreMap.get(b) ?? 1;
//                 return scoreA - scoreB; // Lower score = better match
//             });
//         }

//         setFilteredOptions(matchingItems);
//     }, [debouncedInputValue, fuseInstance, allOptions]);

//     const handleInputChange = (newValue: string, actionMeta: InputActionMeta) => {
//         if (actionMeta.action === 'input-change') {
//             setInputValue(newValue);
//             onSearchInputChange?.(newValue);
//         } else if (actionMeta.action === 'input-blur' && newValue) {
//             setInputValue(newValue);
//             onSearchInputChange?.(newValue);
//         }
//     };

//     const handleSelectChange = (
//         selectedOption: IsMulti extends true ? MultiValue<T> : SingleValue<T>
//     ) => {
//         onChange(selectedOption);
//         setInputValue('');
//     };
    
//     const MappedCustomMenuList = customMenuListComponent
//         ? (props: MenuListProps<T, IsMulti>) => {
//               const CustomComponent = customMenuListComponent;
//               return <CustomComponent {...props} {...customMenuListProps} />;
//           }
//         : components.MenuList;

//     return (
//         <ReactSelect<T, IsMulti>
//             value={value}
//             options={filteredOptions}
//             onInputChange={handleInputChange}
//             onChange={handleSelectChange}
//             filterOption={null}
//             components={{ MenuList: MappedCustomMenuList }}
//             {...restSelectProps}
//         />
//     );
// }

// // ============================================================================
// // USAGE EXAMPLE
// // ============================================================================
// /*
// const options = [
//     { 
//         value: 1, 
//         label: 'Pressure Independent Control Valves (PICV) With Actuators - 150MM',
//         category: 'Valves',
//         specs: 'DN150 PN16'
//     },
//     { 
//         value: 2, 
//         label: 'Ball Valve With Actuator - 100MM',
//         category: 'Valves'
//     }
// ];

// const fuseOptions = {
//     keys: [
//         { name: 'label', weight: 0.7 },      // Search in label with higher weight
//         { name: 'category', weight: 0.2 },   // Also search in category
//         { name: 'specs', weight: 0.1 }       // And in specs
//     ],
//     threshold: 0.3  // Stricter matching (optional, will use 0.4 by default)
// };

// <FuzzySearchSelect
//     allOptions={options}
//     fuseOptions={fuseOptions}
//     value={selectedValue}
//     onChange={setSelectedValue}
//     placeholder="Search items..."
// />

// Now searches like:
// - "actuators picv" ✓
// - "150mm actuator" ✓
// - "picv 150mm" ✓
// - "pressure 150" ✓
// All will match the first item!
// */