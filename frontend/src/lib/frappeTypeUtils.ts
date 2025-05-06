import { ColumnFiltersState } from '@tanstack/react-table';

// This is a basic converter. You might need to expand it based on the
// complexity of filters used by DataTableFacetedFilter or other filter inputs.
export function convertTanstackFiltersToFrappe(
    tanstackFilters: ColumnFiltersState | undefined
): Array<[string, string, any] | string> | Record<string, any> {
    if (!tanstackFilters || tanstackFilters.length === 0) {
        return []; // Return empty array if no filters
    }

    const frappeFilters: Array<[string, string, any]> = [];

    tanstackFilters.forEach(filter => {
        const { id: columnId, value } = filter;

        // --- IMPORTANT: Adapt this logic based on your filter types ---
        // Example 1: Simple equality or "like" from a text input filter
        if (typeof value === 'string' && value.trim() !== '') {
            // You might need a convention here, e.g., if columnId ends with '_like', use "like"
            // For now, assume simple 'like' for string filters from basic inputs
             // frappeFilters.push([columnId, '=', value]); // If you want exact match
             frappeFilters.push([columnId, 'like', `%${value}%`]); // More common for text search
        }
        // Example 2: Faceted filter (multi-select) - assuming value is an array of strings
        else if (Array.isArray(value) && value.length > 0) {
            // TanStack FacetedFilter usually provides an array of selected values
            frappeFilters.push([columnId, 'in', value]);
        }
        // Example 3: Range filter (e.g., date range) - assuming value is { from: Date, to: Date }
        // else if (typeof value === 'object' && value !== null && 'from' in value && 'to' in value) {
        //     frappeFilters.push([columnId, 'between', [formatDateForFrappe(value.from), formatDateForFrappe(value.to)]]);
        // }

        // Add more conditions here for other filter types you implement (range, single select, etc.)
    });

    return frappeFilters; // Return as Frappe's preferred list-of-lists format
}

// Helper function (if needed for date ranges)
// function formatDateForFrappe(date: Date): string {
//     // Format date as 'YYYY-MM-DD'
//     return date.toISOString().split('T')[0];
// }