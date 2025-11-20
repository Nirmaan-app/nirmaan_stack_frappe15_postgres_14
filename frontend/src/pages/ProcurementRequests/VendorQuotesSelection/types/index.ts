import { 
    ProcurementRequest as GlobalProcurementRequest, // Original type from NirmaanStack
    ProcurementRequestItemDetail,      // The definitive child table item structure
    RFQData as GlobalRFQData, // Rename original to avoid conflict
    Category as PRCategoryType // Category structure within PR's category_list JSON
} from "@/types/NirmaanStack/ProcurementRequests";
import { 
    SentBackCategory as GlobalSentBackCategory, // Original type
    // SentBackItem is no longer needed if SBC.order_list uses ProcurementRequestItemDetail
} from "@/types/NirmaanStack/SentBackCategory";
import { TargetRateDetailFromAPI } from "../../ApproveVendorQuotes/types"; // Adjust path

// --- Document Types ---
// Define specific types for PR and SBC that include the new order_list
// export interface AdaptedProcurementRequest extends Omit<GlobalProcurementRequest, 'procurement_list'> {
//     order_list: ProcurementRequestItemDetail[]; // Now uses the child table structure
// }
// export interface AdaptedSentBackCategory extends Omit<GlobalSentBackCategory, 'item_list'> {
//     order_list: ProcurementRequestItemDetail[]; // Now uses the child table structure (same as PR)
// }
export interface AdaptedProcurementRequest extends Omit<GlobalProcurementRequest, 'procurement_list' | 'rfq_data'> {
    order_list: ProcurementRequestItemDetail[];
    rfq_data?: RFQData; // Make RFQData optional and typed
}
export interface AdaptedSentBackCategory extends Omit<GlobalSentBackCategory, 'item_list' | 'rfq_data'> {
    order_list: ProcurementRequestItemDetail[];
    rfq_data?: RFQData; // Make RFQData optional and typed
}


// Union type for the document being processed
export type ProgressDocument = AdaptedProcurementRequest | AdaptedSentBackCategory;


// --- Item Type ---
// We will consistently use ProcurementRequestItemDetail as the structure for items from order_list
export type ProgressItem = ProcurementRequestItemDetail;


// Structure for a single charge (e.g., Loading)
export interface ChargeItem {
    item_id: string;   // The DocName/ID of the original charge item from order_list
    item_name: string; // The name of the charge (e.g., "Loading Charges")
    quote: number;     // The quoted amount for this charge
    tax: number;       // The tax percentage for this charge
    
}
// Define specific types for PR and SBC that include the new order_list


export interface RFQData extends Omit<GlobalRFQData, 'chargesByVendor'> {
    selectedVendors: VendorOption[];
    details: { [itemName: string]: any };
    chargesByVendor?: {
        [vendorId: string]: ChargeItem[];
    };
    
}
// --- Vendor Option Type ---
export interface VendorOption {
    value: string;    // Vendor DocName
    label: string;    // Vendor Name
    city?: string;
    state?: string;
}

// --- Helper Functions ---
// in types.ts or a helpers file

// in types.ts or a similar utility file

export function getItemListFromDocument(doc?: ProgressDocument): ProgressItem[] {
    if (!doc) return [];

    // Since both doctypes use `order_list`, we can unify the logic.
    return doc.order_list || [];
}
// Assuming category_list is still JSON in both PR and SBC for now
export const getCategoryListFromDocument = (doc?: ProgressDocument): PRCategoryType[] => {
    if (!doc || !doc.category_list) return [];
    if (typeof doc.category_list === 'string') {
        try {
            const parsed = JSON.parse(doc.category_list);
            return (parsed && Array.isArray(parsed.list)) ? parsed.list : [];
        } catch (e) {
            console.error("Failed to parse category_list JSON:", e, doc.category_list);
            return [];
        }
    }
    if (typeof doc.category_list === 'object' && Array.isArray(doc.category_list.list)) {
        return doc.category_list.list;
    }
    return [];
};

/**
 * --- NEW ---
 * A helper function to discover the available "Additional Charges" templates from the document.
 * This makes our feature dynamic and backend-driven.
 */
// export function getAdditionalChargesTemplates(doc?: ProgressDocument): { item_id: string, item_name: string }[] {
//     if (!doc || !doc.order_list) return [];
    
//     return doc.order_list
//         .filter(item => item.category === 'Additional Charges')
//         .map(item => ({ item_id: item.item_id, item_name: item.item_name }));
// }

// --- RFQ and Form Data Related Types (can remain largely the same if keys are consistent) ---
// RFQData uses item names/IDs as keys. Ensure these keys match item.item_id from ProgressItem.
export type { RFQData }; // Assuming RFQData structure itself doesn't need to change
                         // Its `details` object is keyed by item ID.

// --- Hook Return Type ---
// This interface defines what useProcurementProgressLogic will return.
// We'll fill this out more as we define the hook.
export interface ProcurementProgressLogicReturn {
    mode: 'edit' | 'view' | 'review';
    prId: string; // docId
    currentDocument?: ProgressDocument;
    setDocumentStateDirectly: React.Dispatch<React.SetStateAction<ProgressDocument | undefined>>; // For direct updates by children

    // RFQ Form Data
    rfqFormData: RFQData;
    setRfqFormData: React.Dispatch<React.SetStateAction<RFQData>>;
    
    // Final Selected Quotes (Item ID -> Vendor ID)
    finalSelectedQuotes: Map<string, string>; 
    setFinalSelectedQuotes: React.Dispatch<React.SetStateAction<Map<string, string>>>;
    
    isLoading: boolean; // General loading for data fetching
    isUpdatingDocument: boolean; // Specific to save/update actions
    isRedirecting: string; // For UI feedback on navigation

    // Dialog/Sheet states
    isAddVendorsDialogOpen: boolean;
    toggleAddVendorsDialog: () => void;
    isRevertDialogOpen: boolean;
    toggleRevertDialog: () => void;
    isVendorSheetOpen: boolean;
    toggleVendorSheet: () => void;

    // Vendor selection for "Add Vendors" dialog
    tempSelectedVendorsInDialog: VendorOption[];
    handleTempVendorSelectionInDialog: (selected: VendorOption[]) => void;
    availableVendorOptionsForDialog: VendorOption[];
        // --- NEW ---: We'll pass the discovered charge templates to the view layer.
    availableChargeTemplates: { item_id: string; item_name: string }[];


    // Handlers
    handleModeChange: (newMode: 'edit' | 'view') => Promise<void>;
    handleConfirmAddVendorsToRFQ: () => void;
    handleTaxChange:(itemId: string, vendorId: string, taxValue: string) => void;
    handleUnitChange: (itemId: string, newUnit: string) => void; //<----Unit Selection options
    handleDeleteVendorFromRFQ: (vendorId: string) => void;
    handleQuoteChange: (itemId: string, vendorId: string, quote: string) => void;
    handleMakeChange: (itemId: string, vendorId: string, makeValue: string) => void;
    handleFinalVendorSelectionForItem: (itemId: string, vendorId: string | null) => void; // Renamed
     // --- NEW CHARGE HANDLERS ---
    onAddCharges: (vendorId: string, chargesToAdd: { item_id: string; item_name: string }[]) => void;
    onUpdateCharge: (vendorId: string, chargeIndex: number, updatedCharge: ChargeItem) => void;
    onDeleteCharge: (vendorId: string, chargeIndex: number) => void;

    // Actions
    handleProceedToReview: () => Promise<void>;
    handleRevertSelections: () => Promise<void>; // Renamed
    handleSaveDraft: () => Promise<boolean>; // New: To explicitly save draft
    
    // Lookups & Derived Data
    getFullName: (userId?: string) => string;
    canContinueToReview: boolean;
    targetRatesDataMap?: Map<string, TargetRateDetailFromAPI>;
    otherEditors: string[];

    updateCurrentDocumentStateItemList: (updater: (prevItems: ProgressItem[]) => ProgressItem[]) => void;
}
