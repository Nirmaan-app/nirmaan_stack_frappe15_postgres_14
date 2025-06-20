// import { ProcurementRequest, RFQData, ProcurementItem } from "@/types/NirmaanStack/ProcurementRequests";
// import { SentBackCategory, SentBackItem } from "@/types/NirmaanStack/SentBackCategory";
// import { TargetRateDetailFromAPI } from "../../ApproveVendorQuotes/types"; // Adjust path

// // Type for vendor options used in select components
// export interface VendorOption {
//     value: string;    // Vendor DocName
//     label: string;    // Vendor Name
//     city?: string;
//     state?: string;
//     // Add any other vendor fields needed for display in the select
// }

// // Document type for the progress page
// export type ProgressDocumentType = ProcurementRequest | SentBackCategory;

// // Helper to get the item list from either document type
// export const getItemListFromDocument = (doc?: ProgressDocumentType): ProcurementItem[] | SentBackItem[] => {
//     if (!doc) return [];
//     if ('procurement_list' in doc && doc.procurement_list?.list) { // ProcurementRequest
//         return doc.procurement_list.list;
//     }
//     if ('item_list' in doc && doc.item_list?.list) { // SentBackCategory
//         return doc.item_list.list;
//     }
//     return [];
// };

// // Helper to get category list (assuming structure is same)
// export const getCategoryListFromDocument = (doc?: ProgressDocumentType) => {
//     if (!doc) return [];
//     return doc.category_list?.list || [];
// }

// // Interface for the return value of useProcurementProgressLogic hook
// // This will be built up as we define the hook
// export interface ProcurementProgressLogic {
//     mode: 'edit' | 'view' | 'review'; // Added 'review' explicitly
//     prId: string;
//     currentDocument?: ProgressDocumentType; // The PR or SBC document
//     formData: RFQData;
//     setFormData: React.Dispatch<React.SetStateAction<RFQData>>;
//     selectedVendorQuotes: Map<string, string>; // item.name -> vendor.name
    
//     isLoading: boolean; // Overall loading for critical operations
//     isUpdatingDocument: boolean; // Specific for document updates
//     isRedirecting: string; // For visual feedback on navigation after action

//     // Dialog/Sheet states and toggles
//     isAddVendorsDialogOpen: boolean;
//     toggleAddVendorsDialog: () => void;
//     isRevertDialogOpen: boolean;
//     toggleRevertDialog: () => void;
//     isVendorSheetOpen: boolean;
//     toggleVendorSheet: () => void;

//     // Vendor selection for dialog
//     tempSelectedVendorsInDialog: VendorOption[];
//     handleTempVendorSelectionInDialog: (selected: VendorOption[]) => void;
//     availableVendorOptionsForDialog: VendorOption[];
    
//     // Handlers
//     handleModeChange: (newMode: 'edit' | 'view') => Promise<void>; // Specific modes
//     handleConfirmAddVendorsToRFQ: () => void;
//     handleDeleteVendorFromRFQ: (vendorId: string) => void;
//     handleQuoteChange: (itemId: string, vendorId: string, quote: string) => void; // quote as string from input
//     handleMakeChange: (itemId: string, vendorId: string, make: string) => void;
//     handleVendorQuoteSelectionForItem: (itemId: string, vendorId: string | null) => void;
//     handleProceedToReview: () => Promise<void>;
//     handleRevertPRChanges: () => Promise<void>;

//     setSelectedVendorQuotes: React.Dispatch<React.SetStateAction<Map<string, string>>>;
    
//     // Lookups & Derived Data
//     getFullName: (userId?: string) => string;
//     canContinueToReview: boolean;
//     targetRatesDataMap?: Map<string, TargetRateDetailFromAPI>; // Map: item.name -> TargetRateDetail
//     isDocumentReadOnlyByWorkflow: boolean; // If workflow state prevents editing RFQ
//     otherEditors: string[]; // For concurrent editing awareness

//     setOrderDataState: React.Dispatch<React.SetStateAction<ProgressDocumentType | undefined>>;
// }



// frontend/src/pages/ProcurementRequests/VendorQuotesSelection/types.ts

import { 
    ProcurementRequest as GlobalProcurementRequest, // Original type from NirmaanStack
    ProcurementRequestItemDetail,      // The definitive child table item structure
    RFQData,
    Category as PRCategoryType // Category structure within PR's category_list JSON
} from "@/types/NirmaanStack/ProcurementRequests";
import { 
    SentBackCategory as GlobalSentBackCategory, // Original type
    // SentBackItem is no longer needed if SBC.order_list uses ProcurementRequestItemDetail
} from "@/types/NirmaanStack/SentBackCategory";
import { TargetRateDetailFromAPI } from "../../ApproveVendorQuotes/types"; // Adjust path

// --- Document Types ---
// Define specific types for PR and SBC that include the new order_list
export interface AdaptedProcurementRequest extends Omit<GlobalProcurementRequest, 'procurement_list'> {
    order_list: ProcurementRequestItemDetail[]; // Now uses the child table structure
}
export interface AdaptedSentBackCategory extends Omit<GlobalSentBackCategory, 'item_list'> {
    order_list: ProcurementRequestItemDetail[]; // Now uses the child table structure (same as PR)
}

// Union type for the document being processed
export type ProgressDocument = AdaptedProcurementRequest | AdaptedSentBackCategory;


// --- Item Type ---
// We will consistently use ProcurementRequestItemDetail as the structure for items from order_list
export type ProgressItem = ProcurementRequestItemDetail;


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
    
    // Handlers
    handleModeChange: (newMode: 'edit' | 'view') => Promise<void>;
    handleConfirmAddVendorsToRFQ: () => void;
    handleTaxChange:(itemId: string, vendorId: string, taxValue: string) => void;
    handleDeleteVendorFromRFQ: (vendorId: string) => void;
    handleQuoteChange: (itemId: string, vendorId: string, quote: string) => void;
    handleMakeChange: (itemId: string, vendorId: string, makeValue: string) => void;
    handleFinalVendorSelectionForItem: (itemId: string, vendorId: string | null) => void; // Renamed
    
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