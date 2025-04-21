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