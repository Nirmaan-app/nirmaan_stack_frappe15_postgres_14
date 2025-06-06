import { 
    ProcurementRequest as GlobalProcurementRequest,
    ProcurementRequestItemDetail, // This is the child table item structure
    RFQData // Assuming RFQData is still relevant and its keys match item_id
} from "@/types/NirmaanStack/ProcurementRequests";
import { ApprovedQuotations as GlobalApprovedQuotations } from "@/types/NirmaanStack/ApprovedQuotations"; // For historical data

// --- Main Document Type for this flow ---
// Ensure this uses order_list
export interface ApproveQuotesPRDoc extends Omit<GlobalProcurementRequest, 'procurement_list'> {
    order_list: ProcurementRequestItemDetail[]; // Key change: items are here
    // rfq_data can remain as is if it's still a JSON field keyed by item_id
    rfq_data: RFQData; // Handle potential string from backend
}

// --- Item Detail for Display in VendorApprovalTable ---
// This extends the backend child table item with UI-specific calculated fields
export interface VendorItemDetailsToDisplay extends ProcurementRequestItemDetail {
    vendor_name?: string; // Populated from Vendors master
    amount: number;       // Calculated: quantity * quote
    
    // Fields related to target rates & comparisons
    targetRate?: number;
    targetAmount?: number;
    lowestQuotedAmountForItem?: number; // Lowest quote for this item across all vendors in current RFQ
    historicalLowestRate?: number; // e.g., 3 months lowest (if you implement this)
    savingLoss?: number;
    contributingHistoricalQuotes?: GlobalApprovedQuotations[]; // For hover card
}

// --- Data structure for VendorApprovalTable's dataSource ---
export interface VendorGroupForTable {
    vendorId: string;
    vendorName: string;
    totalAmount: number; // Sum of 'amount' for items selected from this vendor in RFQ
    items: VendorItemDetailsToDisplay[]; // Items quoted by this vendor
    potentialSavingLossForVendor?: number; // Sum of savingLoss for items from this vendor
    key: string; // Unique key for React list
}

// --- Selection State ---
// Key: vendorId (string)
// Value: Set<string> containing item_id of selected items for that vendor
export type SelectionState = Map<string, Set<string>>;


// --- API Response types for Target Rates (re-iterating from your types) ---
export interface ApiSelectedQuotation { 
    name: string;
    item_id?: string;
    item_name?: string;
    vendor_name?: string; // Important for mapping if needed
    vendor?: string; // Often the vendor *name* (ID) in Frappe
    procurement_order?: string;
    unit?: string;
    quantity?: string;
    quote?: string; // The quoted price in this historical record
    city?: string;
    state?: string;
    category?: string;
    procurement_package?: string;
    make?: string;
    idx: number;
    creation?: string; // Added field
    docstatus?: number; // Added field
    dispatch_date?: string; 
}

export interface TargetRateDetailFromAPI { 
    name: string;
    item_name?: string;
    unit?: string;
    rate?: string; // The calculated target rate
    item_id?: string; // Key for matching
    creation?: string;
    modified?: string;
    selected_quotations_items: ApiSelectedQuotation[]; 
    }
export interface FrappeTargetRateApiResponse { message: TargetRateDetailFromAPI[]; }

// --- Type for HistoricalQuotesHoverCard (re-iterating) ---
// This should align with what HistoricalQuotesHoverCard.tsx expects
export type { GlobalApprovedQuotations as ApprovedQuotationForHoverCard };

// Helper for mapping (re-iterating)
export const mapApiQuotesToApprovedQuotations = (apiQuotes: ApiSelectedQuotation[]): Partial<GlobalApprovedQuotations>[] => {
    // ... your existing mapping logic ...
    // Ensure this correctly maps to ApprovedQuotationForHoverCard fields, especially item_id, item_name
    return apiQuotes.map(cq => ({
        name: cq.name,
        item_id: cq.item_id,
        item_name: cq.item_name,
        vendor_name: cq.vendor_name,
        vendor: cq.vendor, 
        procurement_order: cq.procurement_order,
        quote: cq.quote,
        rate: cq.quote, 
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