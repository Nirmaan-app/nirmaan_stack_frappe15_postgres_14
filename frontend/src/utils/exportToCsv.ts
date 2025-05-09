import { ColumnDef } from '@tanstack/react-table';
// Import UNPARSE from papaparse
import { unparse } from 'papaparse';
import { formatDate as formatDateFn } from 'date-fns'; // Using date-fns for robust date formatting
import { parseNumber } from './parseNumber'; // Assuming this utility exists
import { formatToRoundedIndianRupee } from './FormatPrice';

/**
 * Safely formats a date value using date-fns.
 * Returns an empty string if the date is invalid or null/undefined.
 */
const safeFormatDate = (value: any, formatString: string = 'dd/MM/yyyy'): string => {
    if (!value) return '';
    try {
        const date = new Date(value);
        // Check if the date is valid after parsing
        if (isNaN(date.getTime())) {
            return ''; // Return empty for invalid dates
        }
        return formatDateFn(date, formatString);
    } catch (e) {
        console.error("Date formatting failed:", e);
        return ''; // Return empty on error
    }
};

// /**
//  * Extracts and formats a cell value for CSV export.
//  * Handles basic types and uses column meta for customization.
//  */
// const getCellValue = (row: any, column: ColumnDef<any, any>): string | number | boolean | null => {
//     const accessorKey = column.accessorKey as string | undefined;
//     // Look for a specific export formatter first in column meta
//     const exportValueGetter = (column.meta as any)?.exportValue;
//     // Look for a general cell formatter if no specific export formatter
//     const cellFormatter = column.cell; // We *might* use this, but it's complex due to context

//     let value: any;

//     // 1. Use custom export function if provided
//     if (typeof exportValueGetter === 'function') {
//         value = exportValueGetter(row);
//     }
//     // 2. Use accessorKey if no custom function
//     else if (accessorKey) {
//         const keys = accessorKey.split('.');
//         // Attempt to access nested value safely
//         value = keys.reduce((obj, key) => (obj && typeof obj === 'object' && obj[key] !== undefined) ? obj[key] : undefined, row);
//     }
//     // 3. Fallback (less reliable for complex cells)
//     else {
//         // Attempting to use 'cell' directly is tricky without the render context.
//         // It's better to rely on accessorKey or meta.exportValue.
//         console.warn(`Column "${String(column.header) || accessorKey}" lacks reliable accessorKey or meta.exportValue for export.`);
//         value = ''; // Default fallback
//     }

//     // Basic Type Handling & Formatting
//     if (value === null || value === undefined) {
//         return ''; // Represent null/undefined as empty string
//     }
//     if (value instanceof Date) {
//         return safeFormatDate(value); // Use safe date formatter
//     }
//     // Add specific formatting for numbers if needed (e.g., currency)
//     if (typeof value === 'number') {
//          // Example: Check column meta if it should be formatted as currency
//          if ((column.meta as any)?.isCurrency) {
//               const formattedValue = formatToRoundedIndianRupee(value);
//              return formattedValue
//          }
//          return value; // Return raw number for PapaParse to handle (or value.toString())
//     }
//      if (typeof value === 'boolean') {
//         return value; // Return raw boolean
//     }
//     if (typeof value === 'object') {
//         // Avoid exporting complex objects directly unless intended
//         console.warn(`Exporting complex object for column "${String(column.header) || accessorKey}". Consider using meta.exportValue.`);
//         try {
//             return JSON.stringify(value); // Simple JSON stringify as fallback
//         } catch {
//             return '[Object]'; // Fallback if stringify fails
//         }
//     }

//     // Default: convert to string
//     return String(value);
// };


/**
 * Extracts and formats a cell value for CSV export.
 * Prioritizes meta.exportValue for custom formatting.
 */
// Return type should be primitive values suitable for CSV cells
const getCellValue = (row: any, column: ColumnDef<any, any>): string | number | boolean | null => {
  const accessorKey = column.accessorKey as string | undefined;
  const exportValueGetter = (column.meta as any)?.exportValue;

  // 1. Use custom export function if provided (Most specific)
  //    Assume the function returns the final string representation needed.
  if (typeof exportValueGetter === 'function') {
      // Execute the custom formatter defined in the column meta
      return exportValueGetter(row);
  }

  // 2. If no custom export function, get the raw value using accessorKey
  let rawValue: any;
  if (accessorKey) {
      const keys = accessorKey.split('.');
      rawValue = keys.reduce((obj, key) => (obj && typeof obj === 'object' && obj[key] !== undefined) ? obj[key] : undefined, row);
  } else {
      // Cannot reliably get value without accessorKey or exportValueGetter
      console.warn(`Column "${String(column.header) || 'ID: ' + column.id}" lacks accessorKey or meta.exportValue for export.`);
      rawValue = ''; // Fallback to empty string
  }

  // 3. Apply basic default formatting to the raw value IF no exportValueGetter was used
  if (rawValue === null || rawValue === undefined) {
      return ''; // Represent null/undefined as empty string in CSV
  }
  if (rawValue instanceof Date || column.accessorKey === 'creation') {
      return safeFormatDate(rawValue); // Default date format
  }
  if (typeof rawValue === 'number') {
      // For numbers without specific export formatting, convert to string
      // to prevent potential scientific notation or interpretation issues in Excel/Sheets.
      // Or return the raw number if PapaParse/spreadsheet handling is preferred.
      return rawValue.toString();
  }
  if (typeof rawValue === 'boolean') {
      return rawValue ? 'TRUE' : 'FALSE'; // Explicit TRUE/FALSE strings often work better in CSV
  }
  if (typeof rawValue === 'object') {
      // Avoid exporting complex objects directly
      console.warn(`Exporting complex object for column "${String(column.header) || accessorKey}". Use meta.exportValue.`);
      try {
          return JSON.stringify(rawValue); // Simple JSON stringify as last resort
      } catch {
          return '[Object]';
      }
  }

  // Default: convert any other type to string
  return String(rawValue);
};

/**
 * Exports data to a CSV file using papaparse.unparse.
 * @param filename - The desired filename (without .csv extension).
 * @param data - The array of data objects (or rows) to export.
 * @param columns - The Tanstack Table column definitions to determine headers and accessors.
 */
export const exportToCsv = <TData>(
    filename: string,
    data: TData[],
    columns: ColumnDef<TData, any>[]
) => {
    if (!data || data.length === 0) {
        console.warn('No data provided for CSV export.');
        // Optionally show a toast message to the user
        return;
    }

    try {
        // 1. Filter columns intended for export
        const exportableColumns = columns.filter(col =>
            (col.header || col.accessorKey) && !(col.meta as any)?.excludeFromExport
        );

        // 2. Extract Headers
        const headers = exportableColumns.map(col =>
             // Prefer header string, fallback to accessorKey
            typeof col.header === 'string'
                ? col.header
                : String(col.accessorKey || 'Unknown Column')
        );

        // 3. Extract Row Data using getCellValue
        //    Result should be an array of arrays, where inner arrays contain string/number/boolean values
        const rows = data.map(row =>
            exportableColumns.map(col => getCellValue(row, col))
        );

        // 4. Convert data (including headers) to CSV string using PapaParse.unparse
        //    Pass data as an array where the first element is the header array,
        //    followed by the data rows.
        const csvString = unparse(
            [headers, ...rows], // Combine headers and rows into a single array of arrays
            {
                // Optional configuration for unparse (delimiters, quotes etc.)
                // header: false, // We are providing headers manually in the data array
                skipEmptyLines: true,
            }
        );

        // Ensure csvString is actually a string before creating Blob
        if (typeof csvString !== 'string') {
             throw new Error("PapaParse unparse did not return a string.");
        }

        // 5. Create Blob and Trigger Download
        const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' }); // csvString is now correct
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        const timestamp = formatDateFn(new Date(), 'yyyyMMdd_HHmmss'); // Use date-fns here too
        link.href = url;
        link.setAttribute('download', `${filename}_${timestamp}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url); // Clean up blob URL

        console.log(`Successfully exported ${data.length} rows to ${filename}_${timestamp}.csv`);
         // Optionally show success toast

    } catch (error) {
        console.error('Error exporting data to CSV:', error);
         // Optionally show error toast
         // Re-throw or handle as needed
         throw error; // Optional: re-throw if calling function needs to know about the error
    }
};

// --- Example usage in column definition meta ---
/*
// Example 1: Custom formatting for export
{
    accessorKey: 'userDetails',
    header: 'User Info',
    cell: ({ row }) => `${row.original.userDetails?.firstName} ${row.original.userDetails?.lastName}`, // Display format
    meta: {
        exportValue: (row) => `${row.original.userDetails?.firstName ?? ''},${row.original.userDetails?.lastName ?? ''}`, // Export format (e.g., separate columns in CSV conceptually)
    }
},
// Example 2: Format number as currency ONLY for export
{
    accessorKey: 'amount',
    header: 'Amount',
    cell: ({ row }) => formatCurrencyIndia(row.original.amount), // Display format
    meta: {
        isCurrency: true, // Flag for getCellValue to format using formatCurrencyIndia
        // Alternatively, use exportValue for explicit control:
        // exportValue: (row) => formatCurrencyIndia(row.original.amount)
    }
},
// Example 3: Exclude a column with actions/buttons
{
    id: 'actions', // No accessorKey needed if just rendering buttons
    header: 'Actions',
    cell: ({ row }) => <Button onClick={() => console.log(row.original.id)}>Action</Button>,
    meta: {
        excludeFromExport: true, // Don't include this column in export
    }
}
*/