// src/features/items/constants/items.constants.ts
import { SearchFieldOption } from '@/components/data-table/new-data-table';
import { Items as ItemsType } from "@/types/NirmaanStack/Items";
import { Category as CategoryType } from "@/types/NirmaanStack/Category"; // Assuming you have this type

export const ITEM_DOCTYPE = 'Items';
export const CATEGORY_DOCTYPE = 'Category';

export const ITEM_LIST_FIELDS_TO_FETCH: (keyof ItemsType | 'name')[] = [
    'name',
    'item_name',
    'unit_name',
    'make_name',
    'category',
    'creation',
    'item_status'
];

export const ITEM_SEARCHABLE_FIELDS: SearchFieldOption[] = [
    { value: "item_name", label: "Product Name", placeholder: "Search by product name...", default: true },
    { value: "name", label: "Product ID", placeholder: "Search by product ID..." },
    // { value: "make_name", label: "Make", placeholder: "Search by make..." },
    { value: "category", label: "Category Name", placeholder: "Search by category name..." },
    { value: "unit_name", label: "Unit", placeholder: "Search by unit..." },
];

export const ITEM_DATE_COLUMNS: string[] = ["creation"];

export const CATEGORY_LIST_FIELDS_TO_FETCH: (keyof CategoryType | 'name' | 'work_package')[] = [
    'name',
    'work_package', // Used for display in options
];