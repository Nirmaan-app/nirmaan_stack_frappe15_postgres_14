import { Items } from "@/types/NirmaanStack/Items";
import { ProcurementRequest, ProcurementItemBase, ProcurementRequestItemDetail, Category as GlobalCategory } from "@/types/NirmaanStack/ProcurementRequests";
import { NirmaanUsers } from "@/types/NirmaanStack/NirmaanUsers";
import { NirmaanComments } from "@/types/NirmaanStack/NirmaanComments";
import { ApprovedQuotations } from "@/types/NirmaanStack/ApprovedQuotations";
import {Projects} from "@/types/NirmaanStack/Projects";
import { Category as MasterCategory} from "@/types/NirmaanStack/Category";


// Renaming for clarity within this feature's context

export type { GlobalCategory }
export interface PRCategory {
    name: string;
    makes?: string[];
    status?: 'Pending' | 'Request' | string;
}
export type { NirmaanUsers as User };
export type { NirmaanComments as Comment };
export type { ApprovedQuotations as Quote };
export type { MasterCategory };
export type { Items as Item };
export type { Projects as Project };


// This type will represent the main PR document state *within the hook*
// It can be slightly different from the raw FrappeDoc for ease of use if needed,
// but should align closely with the backend schema for items.
export interface PRScreenData extends Omit<ProcurementRequest, 'procurement_list' | 'category_list' | 'order_list'> {
    // Use the backend child table type directly for items
    order_list: ProcurementRequestItemDetail[]; 
    
    // For category_list, if it's still JSON from backend:
    category_list: { list: PRCategory[] }; // Or null if it might not exist
    // If category_list is also migrated, this would change to a child table array.
}

// This is the frontend representation of an item *within the UI/logic*,
// derived from ProcurementRequestItemDetail. It might be identical or have minor UI-specific additions.
// For simplicity, we can try to use ProcurementRequestItemDetail directly if it fits,
// or create a mapping if significant differences arise.
// Let's alias it for now to make it clear what we're working with locally.
export type PRItemUIData = ProcurementRequestItemDetail; 


// Represents a category entry for display purposes in the UI,
// possibly derived from items in order_list or from PR's category_list.
export interface DisplayCategory {
    name: string; // Category DocName
    displayName: string; // User-friendly category name
    status?: string; // Status of items within this category for this PR
    makes?: string[]; // Applicable makes for this category in this PR (from project or PR itself)
}

// State types within the logic hook
export interface OrderData extends Omit<ProcurementRequest, 'procurement_list' | 'category_list'> {
    procurement_list: { list: ProcurementItemBase[] };
    category_list: { list: PRCategory[] };
    // Add other fields if needed after parsing, although PRDocType should cover it
}

export interface ItemOption {
    label: string;
    value: string; // Item name (docname)
    category: string; // Category name (docname)
    unit: string;
    tax: number;
}

export interface NewItemState {
    item_name?: string;
    unit_name?: string;
    quantity?: number | string; // Use string initially for input, then parse
    comment?: string;
}

export interface EditItemState extends Partial<PRItemUIData> {
    // Inherits fields like name, item, quantity, unit, category, comment etc.
}

export interface RequestItemState {
     name: string;  // new request bug handle
    item_name: string; // Original requested item name
    item_id: string;      // Original requested item name/id (might be temporary)
    unit: string;
    quantity: number | string;
    category: string;
    // For the form within the dialog:
    newItemName?: string; // The name being potentially created/confirmed
    newUnit?: string;
    newCategory?: string;
}

export interface FuzzyMatch extends Items {
    matchPercentage: number;
}

// Re-aliasing PRDocType to make it clear it's the global Frappe type
export type { ProcurementRequest as PRDocType };