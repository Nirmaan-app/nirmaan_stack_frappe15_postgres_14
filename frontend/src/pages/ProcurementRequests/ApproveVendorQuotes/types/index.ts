import { ApprovedQuotations } from "@/types/NirmaanStack/ApprovedQuotations";
import { ProcurementItem } from "@/types/NirmaanStack/ProcurementRequests";

export interface VendorItemDetails extends ProcurementItem { // Extend ProcurementItem
    vendor_name: string; // Always expect vendor name here
    amount: number;
    threeMonthsLowestAmount?: number;
    lowestQuotedAmount: number;
    targetRate?: number;
    targetAmount?: number; // Add if available for display
    // Calculated fields:
    savingLoss?: number // Optional saving/loss per item
    // Add other fields displayed in the table if needed
    contributingQuotes?: ApprovedQuotations[]; // Optional contributing quotes
}

export interface VendorGroup {
    totalAmount: number;
    key: string; // Unique key for the vendor group
    items: VendorItemDetails[];
    potentialSavingLoss?: number;
}

// Interface for the final transformed data structure
// Key is the vendor ID (string)
export interface VendorWiseData {
    [vendorId: string]: VendorGroup;
}

// Type for the sorted array used by the data source
export interface VendorDataSourceItem {
    key: string; // Unique key for the vendor group
    vendorId: string;
    vendorName: string;
    totalAmount: number;
    items: VendorItemDetails[];
    potentialSavingLoss?: number; // Optional total saving/loss for the vendor
}

// Type for the selection state Map
// Key: vendorId (string)
// Value: Set<string> containing the unique identifiers (e.g., item.name) of selected items for that vendor
export type SelectionState = Map<string, Set<string>>;

// Re-confirm or add these interfaces (e.g., in a shared types file)

// Interface for the child items returned by the API
export interface ApiSelectedQuotation {
    name: string;
    item_id?: string | null;
    item_name?: string | null;
    vendor_name?: string | null; // Important for mapping if needed
    vendor?: string | null; // Often the vendor *name* (ID) in Frappe
    procurement_order?: string | null;
    unit?: string | null;
    quantity?: string | null;
    quote?: string | null; // The quoted price in this historical record
    city?: string | null;
    state?: string | null;
    category?: string | null;
    procurement_package?: string | null;
    make?: string | null;
    idx: number;
    dispatch_date?: string | null; // Added field
    creation?: string | null; // Added field
    docstatus?: number; // Added field
}

// Interface for the parent Target Rate object returned by the API
export interface TargetRateDetailFromAPI {
    name: string;
    item_name?: string | null;
    unit?: string | null;
    rate?: string | null; // The calculated target rate
    item_id?: string | null; // Key for matching
    creation?: string;
    modified?: string;
    selected_quotations_items: ApiSelectedQuotation[]; // Array of child items
}

// Interface for the standard Frappe API response wrapper
export interface FrappeTargetRateApiResponse {
    message: TargetRateDetailFromAPI[];
}

// Interface expected by HistoricalQuotesHoverCard (ensure this matches the component's needs)
// This might already exist in @/types/NirmaanStack/ApprovedQuotations.ts - ensure it includes dispatch_date
export interface ApprovedQuotations {
    name: string;
    item_id?: string | null;
    item_name?: string | null;
    vendor_name?: string | null; // If used by hover card
    vendor?: string | null;      // If used by hover card (often vendor name/ID)
    procurement_order?: string | null;
    quote?: string | null;       // The rate in that historical quote
    rate?: string | null;        // Add if hover card expects 'rate' instead of 'quote'
    quantity?: string | null;
    unit?: string | null;
    dispatch_date?: string | null; // Added field
    // Add any other fields the hover card displays
    make?: string | null;
    city?: string | null;
    state?: string | null;
    category?: string | null;
    procurement_package?: string | null;
    idx?: number;
}

// Helper function for mapping (place this in a utils file or within the hook/component)
export const mapApiQuotesToApprovedQuotations = (apiQuotes: ApiSelectedQuotation[]): ApprovedQuotations[] => {
    return apiQuotes.map(cq => ({
        // Explicit mapping: Adjust field names as necessary!
        name: cq.name,
        item_id: cq.item_id,
        item_name: cq.item_name,
        vendor_name: cq.vendor_name, // Pass along if hover card uses it
        vendor: cq.vendor,          // Or map cq.vendor_name to cq.vendor if needed
        procurement_order: cq.procurement_order,
        quote: cq.quote,
        rate: cq.quote, // Assuming hover card might expect 'rate' for the price
        quantity: cq.quantity,
        unit: cq.unit,
        dispatch_date: cq.dispatch_date,
        make: cq.make,
        city: cq.city,
        state: cq.state,
        category: cq.category,
        procurement_package: cq.procurement_package,
        idx: cq.idx,
    }));
};