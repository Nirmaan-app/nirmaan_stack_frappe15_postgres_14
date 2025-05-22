import { Items } from "@/types/NirmaanStack/Items";
import { ProcurementRequest, ProcurementItemBase } from "@/types/NirmaanStack/ProcurementRequests";
import { NirmaanUsers } from "@/types/NirmaanStack/NirmaanUsers";
import { NirmaanComments } from "@/types/NirmaanStack/NirmaanComments";
import { ApprovedQuotations } from "@/types/NirmaanStack/ApprovedQuotations";
import {Projects} from "@/types/NirmaanStack/Projects";
import {Category} from "@/types/NirmaanStack/Category";


// Renaming for clarity within this feature's context
export type { ProcurementRequest as PRDocType };
export type { ProcurementItemBase as PRItem };
export interface PRCategory {
    name: string;
    makes?: string[];
    status?: 'Pending' | 'Request' | string;
}
export type { NirmaanUsers as User };
export type { NirmaanComments as Comment };
export type { ApprovedQuotations as Quote };
export type { Category };
export type { Items as Item };
export type { Projects as Project };


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

export interface EditItemState extends Partial<ProcurementItemBase> {
    // Inherits fields like name, item, quantity, unit, category, comment etc.
}

export interface RequestItemState {
    item_name: string; // Original requested item name
    name: string;      // Original requested item name/id (might be temporary)
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