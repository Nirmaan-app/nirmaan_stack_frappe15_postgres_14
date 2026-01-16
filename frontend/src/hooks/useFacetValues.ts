import { useState, useEffect, useMemo } from 'react';
import { useFrappePostCall } from 'frappe-react-sdk';
import { ColumnFiltersState } from '@tanstack/react-table';
import { debounce } from 'lodash';
import { convertTanstackFiltersToFrappe } from '@/lib/frappeTypeUtils';

// --- Configuration ---
const DEBOUNCE_DELAY = 300; // Slightly faster than main search debounce

// --- Types ---
export interface FacetValue {
    value: string;
    label: string;
    count: number;
}

export interface FacetValuesResult {
    values: FacetValue[];
}

export interface UseFacetValuesConfig {
    doctype: string;
    field: string;
    currentFilters: ColumnFiltersState;
    searchTerm?: string;
    selectedSearchField?: string;
    additionalFilters?: any[];
    enabled?: boolean;
    limit?: number;
}

export interface UseFacetValuesReturn {
    facetOptions: { label: string; value: string }[];
    isLoading: boolean;
    error: Error | null;
    refetch: () => void;
}

/**
 * Hook to fetch dynamic facet values for a specific field
 * with counts based on current filters.
 */
export function useFacetValues({
    doctype,
    field,
    currentFilters,
    searchTerm,
    selectedSearchField,
    additionalFilters = [],
    enabled = true,
    limit = 0  // 0 means no limit - return all facet values
}: UseFacetValuesConfig): UseFacetValuesReturn {

    const [facetValues, setFacetValues] = useState<FacetValue[]>([]);
    const [error, setError] = useState<Error | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    const { call: fetchFacetValues, loading: isCallingApi, error: apiError, reset: resetApiState } = useFrappePostCall<{ message: FacetValuesResult }>(
        'nirmaan_stack.api.data-table.get_facet_values'
    );

    // Convert Tanstack filters to Frappe format, excluding the current field
    const frappeFilters = useMemo(() => {
        const tanstackGeneratedFilters = convertTanstackFiltersToFrappe(currentFilters);
        let combinedFilters = [...additionalFilters];

        if (Array.isArray(tanstackGeneratedFilters) && tanstackGeneratedFilters.length > 0) {
            combinedFilters.push(...tanstackGeneratedFilters);
        }

        // Remove filters for the field we're faceting on
        // (backend also does this, but doing it here reduces payload size)
        combinedFilters = combinedFilters.filter(f => {
            if (Array.isArray(f)) {
                // Handle [field, op, value] or [doctype, field, op, value] format
                const fieldName = f.length === 3 ? f[0] : (f.length === 4 ? f[1] : null);
                return fieldName !== field;
            }
            return true;
        });

        return combinedFilters;
    }, [currentFilters, additionalFilters, field]);

    // Debounced fetch function
    const debouncedFetch = useMemo(
        () => debounce(async (
            doctypeParam: string,
            fieldParam: string,
            filtersParam: any[],
            searchTermParam?: string,
            searchFieldParam?: string
        ) => {
            if (!enabled) {
                setIsLoading(false);
                return;
            }

            setIsLoading(true);
            setError(null);
            resetApiState();

            try {
                const payload = {
                    doctype: doctypeParam,
                    field: fieldParam,
                    filters: JSON.stringify(filtersParam),
                    search_term: searchTermParam || undefined,
                    current_search_fields: searchTermParam && searchFieldParam
                        ? JSON.stringify([searchFieldParam])
                        : undefined,
                    limit: limit
                };

                const response = await fetchFacetValues(payload);

                if (response?.message?.values) {
                    setFacetValues(response.message.values);
                } else {
                    setFacetValues([]);
                }
            } catch (err: any) {
                console.error('Error fetching facet values:', err);
                const errorMessage = err.message || 'Failed to fetch facet values';
                setError(err instanceof Error ? err : new Error(errorMessage));
                setFacetValues([]);
            } finally {
                setIsLoading(false);
            }
        }, DEBOUNCE_DELAY),
        [enabled, fetchFacetValues, resetApiState, limit]
    );

    // Effect to trigger fetch when dependencies change
    useEffect(() => {
        if (enabled) {
            debouncedFetch(doctype, field, frappeFilters, searchTerm, selectedSearchField);
        } else {
            setFacetValues([]);
            setIsLoading(false);
        }

        // Cleanup: cancel pending debounced calls
        return () => {
            debouncedFetch.cancel();
        };
    }, [enabled, doctype, field, JSON.stringify(frappeFilters), searchTerm, selectedSearchField, debouncedFetch]);

    // Manual refetch function
    const refetch = () => {
        if (enabled) {
            debouncedFetch.cancel(); // Cancel any pending debounced call
            debouncedFetch(doctype, field, frappeFilters, searchTerm, selectedSearchField);
        }
    };

    // Format facet values for DataTableFacetedFilter component
    const facetOptions = useMemo(() => {
        return facetValues.map(fv => ({
            label: `${fv.label} (${fv.count})`, // Show count in label
            value: fv.value
        }));
    }, [facetValues]);

    return {
        facetOptions,
        isLoading: isLoading || isCallingApi,
        error: error || (apiError ? new Error(String(apiError)) : null),
        refetch
    };
}
