import { ProcurementRequest, RFQData, ProcurementItem } from "@/types/NirmaanStack/ProcurementRequests";
import { SentBackCategory, SentBackItem } from "@/types/NirmaanStack/SentBackCategory";
import { TargetRateDetailFromAPI } from "../../ApproveVendorQuotes/types"; // Adjust path

// Type for vendor options used in select components
export interface VendorOption {
    value: string;    // Vendor DocName
    label: string;    // Vendor Name
    city?: string;
    state?: string;
    // Add any other vendor fields needed for display in the select
}

// Document type for the progress page
export type ProgressDocumentType = ProcurementRequest | SentBackCategory;

// Helper to get the item list from either document type
export const getItemListFromDocument = (doc?: ProgressDocumentType): ProcurementItem[] | SentBackItem[] => {
    if (!doc) return [];
    if ('procurement_list' in doc && doc.procurement_list?.list) { // ProcurementRequest
        return doc.procurement_list.list;
    }
    if ('item_list' in doc && doc.item_list?.list) { // SentBackCategory
        return doc.item_list.list;
    }
    return [];
};

// Helper to get category list (assuming structure is same)
export const getCategoryListFromDocument = (doc?: ProgressDocumentType) => {
    if (!doc) return [];
    return doc.category_list?.list || [];
}

// Interface for the return value of useProcurementProgressLogic hook
// This will be built up as we define the hook
export interface ProcurementProgressLogic {
    mode: 'edit' | 'view' | 'review'; // Added 'review' explicitly
    prId: string;
    currentDocument?: ProgressDocumentType; // The PR or SBC document
    formData: RFQData;
    setFormData: React.Dispatch<React.SetStateAction<RFQData>>;
    selectedVendorQuotes: Map<string, string>; // item.name -> vendor.name
    
    isLoading: boolean; // Overall loading for critical operations
    isUpdatingDocument: boolean; // Specific for document updates
    isRedirecting: string; // For visual feedback on navigation after action

    // Dialog/Sheet states and toggles
    isAddVendorsDialogOpen: boolean;
    toggleAddVendorsDialog: () => void;
    isRevertDialogOpen: boolean;
    toggleRevertDialog: () => void;
    isVendorSheetOpen: boolean;
    toggleVendorSheet: () => void;

    // Vendor selection for dialog
    tempSelectedVendorsInDialog: VendorOption[];
    handleTempVendorSelectionInDialog: (selected: VendorOption[]) => void;
    availableVendorOptionsForDialog: VendorOption[];
    
    // Handlers
    handleModeChange: (newMode: 'edit' | 'view') => Promise<void>; // Specific modes
    handleConfirmAddVendorsToRFQ: () => void;
    handleDeleteVendorFromRFQ: (vendorId: string) => void;
    handleQuoteChange: (itemId: string, vendorId: string, quote: string) => void; // quote as string from input
    handleMakeChange: (itemId: string, vendorId: string, make: string) => void;
    handleVendorQuoteSelectionForItem: (itemId: string, vendorId: string | null) => void;
    handleProceedToReview: () => Promise<void>;
    handleRevertPRChanges: () => Promise<void>;

    setSelectedVendorQuotes: React.Dispatch<React.SetStateAction<Map<string, string>>>;
    
    // Lookups & Derived Data
    getFullName: (userId?: string) => string;
    canContinueToReview: boolean;
    targetRatesDataMap?: Map<string, TargetRateDetailFromAPI>; // Map: item.name -> TargetRateDetail
    isDocumentReadOnlyByWorkflow: boolean; // If workflow state prevents editing RFQ
    otherEditors: string[]; // For concurrent editing awareness

    setOrderDataState: React.Dispatch<React.SetStateAction<ProgressDocumentType | undefined>>;
}