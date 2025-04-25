// Represents an item within the Procurement Request list (stored in Zustand)
export interface ProcurementRequestItem {
  uniqueId?: string; // Client-side unique ID for list keys before saving
  name: string;      // Item DocName (or UUID for new/requested items)
  item: string;      // Item display name
  unit: string;
  quantity: number;
  category: string;  // Category DocName (key)
  tax: number;
  comment?: string;
  make?: string;     // Selected Make DocName for this item
  status: 'Pending' | 'Request' | 'Approved' | 'Rejected'; // Add other relevant statuses if needed
  // Add any other item-specific fields you might need to store
}

// Represents a category selection derived from the procList
export interface CategorySelection {
  name: string;   // Category DocName (key)
  status: string; // Status of items within this category in the list
  makes: string[]; // List of applicable Make DocNames for this category
  // Add makes if you decide to store/derive them here later
}

// For React Select options
export interface SelectOption<T = string> {
  value: T;
  label: string;
}

export interface CategoryOption extends SelectOption<string> {
  tax: number;
  newItemsDisabled?: boolean; // Flag derived from Category DocType
}

export interface ItemOption extends SelectOption<string> {
  unit: string;
  category: string; // Category DocName (key)
  tax: number;
}

export interface MakeOption extends SelectOption<string> {}

export type CategoryMakesMap = Record<string, string[]>; // Map of category names to applicable makes

// Extend Frappe Types if needed (Example - ensure Category has new_items)
// Assuming Category type is imported from '@/types/NirmaanStack/Category'
// declare module '@/types/NirmaanStack/Category' {
//   interface Category {
//       new_items?: "true" | "false"; // Based on your original code check
//   }
// }