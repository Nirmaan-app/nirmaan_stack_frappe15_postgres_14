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
        // setInputValue('');
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