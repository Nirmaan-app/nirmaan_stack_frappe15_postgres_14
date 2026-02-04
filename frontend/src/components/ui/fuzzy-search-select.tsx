// import React, { useState, useEffect, useMemo, useCallback } from 'react';
// import ReactSelect, {
//     Props as SelectProps, // Import Props type from react-select
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
//     value: any; // Can be string, number, or object
//     label: string;
//     [key: string]: any; // Allow other properties for data an_stackd Fuse.js keys
// }

// // Props for our custom component
// // Extends ReactSelect's props to allow passing them through
// interface FuzzySearchSelectProps<T extends FuzzyOptionType, IsMulti extends boolean = false>
//     extends Omit<SelectProps<T, IsMulti>, 'options' | 'filterOption' | 'onInputChange' | 'onChange'> {
    
//     allOptions: T[]; // The complete, unfiltered list of options
//     fuseOptions: IFuseOptions<T>; // Configuration for Fuse.js
//     debounceDelay?: number;
    
//     // Override onChange to work with our internal state and external callback
//     onChange: (selectedOption: IsMulti extends true ? MultiValue<T> : SingleValue<T>) => void;
    
//     // Optional: If parent needs to know the raw input value from the select's search box
//     onSearchInputChange?: (inputValue: string) => void;

//     // Optional: For rendering custom elements in the menu list (e.g., "Create New" button)
//     // This function receives props similar to react-select's MenuList component
//     // and should render props.children to display the options.
//     customMenuListComponent?: React.ComponentType<MenuListProps<T, IsMulti>>;
//     // Props to pass to customMenuListComponent (like onAddItemClick)
//     customMenuListProps?: Record<string, any>;
// }

// export function FuzzySearchSelect<T extends FuzzyOptionType, IsMulti extends boolean = false>({
//     allOptions,
//     fuseOptions,
//     debounceDelay = 300,
//     onChange,
//     onSearchInputChange,
//     customMenuListComponent,
//     customMenuListProps,
//     value, // Value prop from react-select, managed by parent
//     ...restSelectProps // Rest of the react-select props
// }: FuzzySearchSelectProps<T, IsMulti>) {

//     const [inputValue, setInputValue] = useState('');
//     const [debouncedInputValue, setDebouncedInputValue] = useState('');
//     const [filteredOptions, setFilteredOptions] = useState<T[]>(allOptions);

//     // Memoize Fuse instance
//     const fuseInstance = useMemo(() => {
//         if (!allOptions || allOptions.length === 0) return null;
//         return new Fuse(allOptions, fuseOptions);
//     }, [allOptions, fuseOptions]); // Recreate if options or fuse config change

//     // Debounce the input value for searching
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

//     // Perform search when debounced input value changes
//     useEffect(() => {
//         if (!debouncedInputValue.trim() || !fuseInstance) {
//             setFilteredOptions(allOptions); // Show all if no input or Fuse not ready
//             return;
//         }
//         const results = fuseInstance.search(debouncedInputValue);
//         setFilteredOptions(results.map(result => result.item));
//     }, [debouncedInputValue, fuseInstance, allOptions]);

//     // Handle input change from ReactSelect
//     const handleInputChange = (newValue: string, actionMeta: InputActionMeta) => {
//         // We only want to update state on actual input typing
//         if (actionMeta.action === 'input-change') {
//             setInputValue(newValue);
//             onSearchInputChange?.(newValue); // Notify parent if needed
//         } else if (actionMeta.action === 'input-blur' && newValue) {
//              // If input is blurred with content, keep it for debouncing
//             setInputValue(newValue);
//             onSearchInputChange?.(newValue);
//         }
//         // For 'set-value' (when an option is selected) or 'menu-close', don't necessarily clear input
//         // This allows the selected value to remain visible, and the parent can control clearing if needed
//     };

//     const handleSelectChange = (
//         selectedOption: IsMulti extends true ? MultiValue<T> : SingleValue<T>
//     ) => {
//         onChange(selectedOption); // Call parent's onChange
//         // Optionally, clear the input field after selection, or let parent control this
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
//             value={value} // Controlled by parent
//             options={filteredOptions}
//             onInputChange={handleInputChange}
//             onChange={handleSelectChange}
//             filterOption={null} // IMPORTANT: Disable internal filtering
//             components={{ MenuList: MappedCustomMenuList }}
//             // Pass through any other react-select props
//             {...restSelectProps}
//         />
//     );
// }



//Approach B
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import ReactSelect, {
    Props as SelectProps,
    SingleValue,
    MultiValue,
    InputActionMeta,
    components,
    MenuListProps,
    StylesConfig
} from 'react-select';
import { debounce } from 'lodash';
import { getSelectStyles, mergeSelectStyles } from "@/config/selectTheme";

// Generic Option type for ReactSelect
export interface FuzzyOptionType {
    value: any;
    label: string;
    [key: string]: any;
}

// ============================================================================
// CHANGE 1: New configuration interface for custom token-based search
// ============================================================================
export interface TokenSearchConfig {
    // Fields to search in (e.g., ['label', 'category', 'specs'])
    searchFields: string[];
    
    // Minimum characters required to trigger search
    minSearchLength?: number;
    
    // Case sensitive search (default: false)
    caseSensitive?: boolean;
    
    // Match partial tokens (default: true)
    // If true: "act" matches "actuators"
    // If false: only exact word matches
    partialMatch?: boolean;
    
    // Minimum token length to consider (default: 1)
    minTokenLength?: number;
    
    // Custom token separator regex (default: /\s+/)
    tokenSeparator?: RegExp;
    
    // Weight/priority for each field (optional)
    // Higher weight = appears higher in results
    fieldWeights?: Record<string, number>;
    
    // Minimum number of tokens that must match (default: 1)
    minTokenMatches?: number;
}

// ============================================================================
// CHANGE 2: Scoring system for ranking results
// ============================================================================
interface SearchMatch {
    item: FuzzyOptionType;
    score: number;
    matchedFields: string[];
    matchPositions: Record<string, number[]>; // Field -> positions where tokens matched
    isFullMatch: boolean; // Track if all tokens matched
    matchedTokenCount: number; // Track how many tokens matched
}

const tokenSearchConfig = {
    searchFields: ['label', 'value'],
    minSearchLength: 1,
    partialMatch: true,
    minTokenLength: 1,
    fieldWeights: {
        'label': 2.0,        // Label is most important
        'value': 1.5,        // Value is pretty important
    },
    minTokenMatches: 1      // At least one token must match
};

// Calculate match score for an item
function calculateMatchScore(
    item: FuzzyOptionType,
    searchTokens: string[],
    config: Required<TokenSearchConfig>
): SearchMatch | null {
    const { searchFields, caseSensitive, partialMatch, fieldWeights, minTokenMatches } = config;
    
    let totalScore = 0;
    const matchedFields: string[] = [];
    const matchPositions: Record<string, number[]> = {};
    
    // Track which tokens were matched (instead of requiring all)
    const tokenMatchStatus = new Array(searchTokens.length).fill(false);
    let totalTokenMatches = 0;

    for (const field of searchFields) {
        const fieldValue = String(item[field] || '');
        const searchableText = caseSensitive ? fieldValue : fieldValue.toLowerCase();
        const fieldWeight = fieldWeights[field] || 1;
        
        let fieldMatchCount = 0;
        const positions: number[] = [];

        searchTokens.forEach((token, tokenIndex) => {
            const searchToken = caseSensitive ? token : token.toLowerCase();
            
            if (partialMatch) {
                const position = searchableText.indexOf(searchToken);
                if (position !== -1) {
                    if (!tokenMatchStatus[tokenIndex]) {
                        tokenMatchStatus[tokenIndex] = true;
                        totalTokenMatches++;
                    }
                    fieldMatchCount++;
                    positions.push(position);
                }
            } else {
                const wordBoundaryRegex = new RegExp(`\\b${escapeRegex(searchToken)}\\b`, 'i');
                if (wordBoundaryRegex.test(searchableText)) {
                    if (!tokenMatchStatus[tokenIndex]) {
                        tokenMatchStatus[tokenIndex] = true;
                        totalTokenMatches++;
                    }
                    fieldMatchCount++;
                    const match = searchableText.match(wordBoundaryRegex);
                    if (match) positions.push(match.index || 0);
                }
            }
        });

        if (fieldMatchCount > 0) {
            matchedFields.push(field);
            matchPositions[field] = positions;
            
            // Score calculation
            const matchRatio = fieldMatchCount / searchTokens.length;
            const avgPosition = positions.length > 0 
                ? positions.reduce((a, b) => a + b, 0) / positions.length 
                : 0;
            const positionScore = positions.length > 0 ? 1 / (avgPosition + 1) : 0;
            
            totalScore += (matchRatio * 1000 + positionScore * 100) * fieldWeight;
        }
    }

    // Check if minimum token matches requirement is met
    if (totalTokenMatches < minTokenMatches) {
        return null;
    }

    // Calculate if this is a full match (all tokens matched)
    const isFullMatch = tokenMatchStatus.every(status => status);

    // Bonus for full matches
    if (isFullMatch) {
        totalScore *= 1.5; // 50% bonus for full matches
    }

    return {
        item,
        score: totalScore,
        matchedFields,
        matchPositions,
        isFullMatch,
        matchedTokenCount: totalTokenMatches
    };
}

// Helper to escape special regex characters
function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ============================================================================
// CHANGE 3: Updated Props interface (removed fuseOptions, added tokenSearchConfig)
// ============================================================================
interface FuzzySearchSelectProps<T extends FuzzyOptionType, IsMulti extends boolean = false>
    extends Omit<SelectProps<T, IsMulti>, 'options' | 'filterOption' | 'onInputChange' | 'onChange'> {
    
    allOptions: T[];
    
    // Replaced fuseOptions with tokenSearchConfig
    tokenSearchConfig: TokenSearchConfig;
    
    debounceDelay?: number;
    onChange: (selectedOption: IsMulti extends true ? MultiValue<T> : SingleValue<T>) => void;
    onSearchInputChange?: (inputValue: string) => void;
    customMenuListComponent?: React.ComponentType<MenuListProps<T, IsMulti>>;
    customMenuListProps?: Record<string, any>;
    /** Custom styles to override or extend default theme */
    styles?: StylesConfig<T, IsMulti>;
}

// Custom Option component to show match quality
const CustomOption = (props: any) => {
    const { data, innerRef, innerProps, selectProps } = props;
    
    // Get match information if available
    const matchInfo = data.matchInfo;
    
    return (
        <div ref={innerRef} {...innerProps} className="flex items-center justify-between hover:bg-blue-100 p-2">
            <div className="flex-1">
                {props.children}
            </div>
            {matchInfo && (
                <div className="text-xs text-gray-500 mr-2">
                    {matchInfo.isFullMatch ? (
                        <span className="text-green-600 font-medium">Full match</span>
                    ) : (
                        <span>{matchInfo.matchedTokenCount}/{matchInfo.totalTokens} tokens</span>
                    )}
                </div>
            )}
        </div>
    );
};

// ============================================================================
// CHANGE 4: Main component with custom token-based search (NO Fuse.js)
// ============================================================================
export function FuzzySearchSelect<T extends FuzzyOptionType, IsMulti extends boolean = false>({
    allOptions,
    debounceDelay = 300,
    onChange,
    onSearchInputChange,
    customMenuListComponent,
    customMenuListProps,
    value,
    styles: customStyles,
    tokenSearchConfig: userSearchConfig,
    ...restSelectProps
}: FuzzySearchSelectProps<T, IsMulti>) {

    const [inputValue, setInputValue] = useState('');
    const [debouncedInputValue, setDebouncedInputValue] = useState('');
    const [filteredOptions, setFilteredOptions] = useState<T[]>(allOptions);

    // Merge default theme with custom styles
    const mergedStyles = useMemo(() => {
        const defaultStyles = getSelectStyles<T, IsMulti>();
        if (!customStyles) return defaultStyles;
        return mergeSelectStyles(defaultStyles, customStyles);
    }, [customStyles]);

    // Merge user config with defaults (use passed config or fall back to default)
    const effectiveSearchConfig = userSearchConfig || tokenSearchConfig;
    const config: Required<TokenSearchConfig> = useMemo(() => ({
        searchFields: effectiveSearchConfig.searchFields,
        minSearchLength: effectiveSearchConfig.minSearchLength ?? 1,
        caseSensitive: effectiveSearchConfig.caseSensitive ?? false,
        partialMatch: effectiveSearchConfig.partialMatch ?? true,
        minTokenLength: effectiveSearchConfig.minTokenLength ?? 1,
        tokenSeparator: effectiveSearchConfig.tokenSeparator ?? /\s+/,
        fieldWeights: effectiveSearchConfig.fieldWeights ?? {},
        minTokenMatches: effectiveSearchConfig.minTokenMatches ?? 1
    }), [effectiveSearchConfig]);

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

    // ============================================================================
    // CHANGE 5: Custom token-based search and ranking logic
    // ============================================================================
    useEffect(() => {
        const trimmedInput = debouncedInputValue.trim();
        
        // Show all options if input is too short
        if (!trimmedInput || trimmedInput.length < config.minSearchLength) {
            setFilteredOptions(allOptions);
            return;
        }

        // Tokenize the search input
        const searchTokens = trimmedInput
            .split(config.tokenSeparator)
            .map(token => token.trim())
            .filter(token => token.length >= config.minTokenLength);

        if (searchTokens.length === 0) {
            setFilteredOptions(allOptions);
            return;
        }

        // Score and filter all options
        const matchResults: SearchMatch[] = [];
        
        for (const option of allOptions) {
            const matchResult = calculateMatchScore(option, searchTokens, config);
            if (matchResult) {
                matchResults.push(matchResult);
            }
        }

        // Sort by match quality
        matchResults.sort((a, b) => {
            // First sort by full match status
            if (a.isFullMatch !== b.isFullMatch) {
                return a.isFullMatch ? -1 : 1;
            }
            // Then by number of matched tokens
            if (a.matchedTokenCount !== b.matchedTokenCount) {
                return b.matchedTokenCount - a.matchedTokenCount;
            }
            // Finally by score
            return b.score - a.score;
        });

        // Extract the items and attach match info for display
        const filtered = matchResults.map(result => ({
            ...result.item,
            matchInfo: {
                isFullMatch: result.isFullMatch,
                matchedTokenCount: result.matchedTokenCount,
                totalTokens: searchTokens.length
            }
        }));
        
        setFilteredOptions(filtered);
    }, [debouncedInputValue, allOptions, config]);

    useEffect(() => {
    // If input value is cleared, also clear the debounced value
    if (!inputValue) {
        setDebouncedInputValue("");
    }
}, [inputValue]);

    const handleInputChange = (newValue: string, actionMeta: InputActionMeta) => {
        if (actionMeta.action === 'input-change') {
            setInputValue(newValue);
            onSearchInputChange?.(newValue);
        } else if (actionMeta.action === 'input-blur' && newValue) {
            setInputValue(newValue);
            onSearchInputChange?.(newValue);
        }else if (actionMeta.action === 'menu-close') {
        // Only clear when the menu is closed (after selection)
        setInputValue("");
    }
    };

    const handleSelectChange = (
        selectedOption: IsMulti extends true ? MultiValue<T> : SingleValue<T>
    ) => {
        onChange(selectedOption);
        setInputValue("");
    };
    
    const MappedCustomMenuList = customMenuListComponent
        ? (props: MenuListProps<T, IsMulti>) => {
              const CustomComponent = customMenuListComponent;
              return <CustomComponent {...props} {...customMenuListProps} />;
          }
        : components.MenuList;

    return (
        <ReactSelect<T, IsMulti>
            value={value}
            options={filteredOptions}
            onInputChange={handleInputChange}
            onChange={handleSelectChange}
            filterOption={null}
            styles={mergedStyles}
            components={{
                MenuList: MappedCustomMenuList,
            }}
            {...restSelectProps}
        />
    );
}