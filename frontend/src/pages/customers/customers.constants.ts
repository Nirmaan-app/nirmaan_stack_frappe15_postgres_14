import { SearchFieldOption } from '@/components/data-table/new-data-table';
import { Customers as CustomersType } from "@/types/NirmaanStack/Customers";

export const CUSTOMER_DOCTYPE = 'Customers';

export const CUSTOMER_LIST_FIELDS_TO_FETCH: (keyof CustomersType | 'name')[] = [
    'name', // Customer ID
    'company_name',
    'company_contact_person',
    'company_phone',
    'company_email',
    'creation',
];

export const CUSTOMER_SEARCHABLE_FIELDS: SearchFieldOption[] = [
    { value: "company_name", label: "Company Name", placeholder: "Search by company name...", default: true },
    { value: "name", label: "Customer ID", placeholder: "Search by ID..." },
    { value: "company_contact_person", label: "Contact Person", placeholder: "Search by contact person..." },
    { value: "company_email", label: "Email", placeholder: "Search by email..." },
    { value: "company_phone", label: "Phone", placeholder: "Search by phone..." },
];

export const CUSTOMER_DATE_COLUMNS: string[] = ["creation", "modified"];