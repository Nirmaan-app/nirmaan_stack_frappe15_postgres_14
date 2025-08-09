import { Customers } from "@/types/NirmaanStack/Customers";
import { ProcurementOrder } from "@/types/NirmaanStack/ProcurementOrders";
import { ProjectInflows } from "@/types/NirmaanStack/ProjectInflows";
import { ProjectInvoice } from "@/types/NirmaanStack/ProjectInvoice";
import { ExpenseType } from "@/types/NirmaanStack/ExpenseType";
import { NonProjectExpenses } from "@/types/NirmaanStack/NonProjectExpenses";
import { ProjectExpenses } from "@/types/NirmaanStack/ProjectExpenses";

import { ProjectPayments } from "@/types/NirmaanStack/ProjectPayments";
import { Projects } from "@/types/NirmaanStack/Projects";
import { ServiceRequests } from "@/types/NirmaanStack/ServiceRequests";
import { Vendors } from "@/types/NirmaanStack/Vendors";
import { Filter, FrappeDoc } from "frappe-react-sdk";

// Define interfaces for filter objects to ensure consistency
interface ListParams {
  fields?: string[];
  // filters?: (string | number | boolean | string[])[][];
  filters?: Filter<any>[];
  orderBy?: { field: string; order: 'asc' | 'desc' };
  limit?: number;
  // Add other potential list options if needed
}

interface CategoryListParams extends ListParams {
  workPackage?: string;
}

interface ItemListParams extends ListParams {
  categoryNames?: string[];
}

interface CommentListParams extends ListParams {
  referenceName?: string;
}

// Add params interface and options helper for Vendors
interface VendorListParams extends ListParams {
  vendorType?: string[]; // Example filter param
}

// Interface for report-specific list fetching
interface ProjectListParams extends ListParams { }
interface POListParams extends ListParams { }
interface SRListParams extends ListParams { }
interface PaymentListParams extends ListParams { }
interface InflowListParams extends ListParams { }
interface ProjectInvoiceParams extends ListParams { }
interface CustomerListParams extends ListParams { }
interface ExpenseTypeListParams extends ListParams { }
interface NonProjectExpenseListParams extends ListParams { }
interface ProjectExpenseListParams extends ListParams { }


// --- Define Fields Constants (Good Practice) ---
const PROJECT_REPORT_FIELDS: (keyof Projects)[] = ['name', 'project_name', 'project_value', 'creation', 'modified'];
const PO_REPORT_FIELDS: (keyof ProcurementOrder)[] = ['name', 'creation', 'project', 'vendor', 'total_amount', 'loading_charges', 'freight_charges', 'invoice_data', 'status', 'modified', 'project_name', 'vendor_name', 'dispatch_date',"latest_delivery_date","latest_payment_date"];
const SR_REPORT_FIELDS: (keyof ServiceRequests)[] = ['name', 'creation', 'project', 'vendor', 'service_order_list', 'gst', 'invoice_data', 'status', 'modified'];
const PAYMENT_REPORT_FIELDS: (keyof ProjectPayments)[] = ['name', 'document_type', 'document_name', 'project', 'amount', 'status']; // Added 'project'
const INFLOW_REPORT_FIELDS: (keyof ProjectInflows)[] = ['name', 'project', 'amount', 'payment_date']; // Add fields as needed
const PROJECT_INVOICE_REPORT_FIELDS: (keyof ProjectInvoice)[] = ['name', 'project', 'amount']; // Add fields as needed
const PROJECT_MINIMAL_FIELDS: (keyof Projects)[] = ['name', 'project_name'];
const VENDOR_MINIMAL_FIELDS: (keyof Vendors)[] = ['name', 'vendor_name']; // Assuming this type/field exists

const CUSTOMER_MINIMAL_FIELDS: (keyof Customers)[] = ['name', 'company_name'];

const EXPENSE_TYPE_MINIMAL_FIELDS: (keyof ExpenseType)[] = ['name', 'expense_name', 'project', 'non_project'];
const NON_PROJECT_EXPENSE_DEFAULT_FIELDS: (keyof NonProjectExpenses | `type.${string}`)[] = [
  "name", "creation", "modified", "owner",
  "type",
  "description", "amount",
  "payment_date", "payment_ref", "payment_attachment",
  "invoice_date", "invoice_ref", "invoice_attachment",
];

const PROJECT_EXPENSE_DEFAULT_FIELDS: (keyof ProjectExpenses | `type.${string}`)[] = [
  "name", "creation", "modified", "owner",
  "projects",
  "vendor",
  "description", "comment", "amount",
  "payment_date", "payment_by",
];

// Main query key generator object
export const queryKeys = {
  // For Nirmaan Users
  users: {
    list: (params?: ListParams) => ['Nirmaan Users', 'list', params ?? {}] as const,
    // detail: (userId: string) => ['Nirmaan Users', 'detail', userId] as const, // Example if needed
  },

  // For Categories
  categories: {
    list: (params: CategoryListParams) => ['Category', 'list', params] as const,
  },

  // For Items
  items: {
    list: (params: ItemListParams) => ['Items', 'list', params] as const,
  },
  approvedQuotations: {
    list: (params?: ListParams) => ['Approved Quotations', 'list', params ?? {}] as const,

  },
  // For Approved Quotations
  quotes: {
    list: (params?: ListParams) => ['Approved Quotations', 'list', params ?? {}] as const,
  },

  // For Nirmaan Comments
  comments: {
    list: (params: CommentListParams) => ['Nirmaan Comments', 'list', params] as const,
    // listByDoc: (docname: string, subject: string | string[], params: string, ) => ['Nirmaan Comments', 'list', docname, subject, params] as const
  },

  // For Procurement Requests (used in Container)
  procurementRequests: {
    doc: (docId: string) => ['Procurement Requests', docId] as const,
    // list: (params?: ListParams) => ['Procurement Requests', 'list', params ?? {}] as const, // Example for list view
  },

  // For Projects (Refined)
  projects: {
    doc: (docId: string) => ['Projects', docId] as const,
    list: (params?: ProjectListParams) => ['Projects', 'list', params ?? {}] as const,
    allMinimal: () => ['Projects', 'allMinimalLookup'] as const,
  },

  customers: {
    doc: (docId: string) => ['Customers', docId] as const,
    list: (params?: CustomerListParams) => ['Customers', 'list', params ?? {}] as const,
  },

  vendors: {
    list: (params?: VendorListParams) => ['Vendors', 'list', params ?? {}] as const,
    // detail: (vendorId: string) => ['Vendors', 'detail', vendorId] as const,
    allMinimal: () => ['Vendors', 'allMinimalLookup'] as const, // New key
  },

  sentBackCategory: {
    doc: (docId: string) => ['Sent Back Category', docId] as const,
    // list: (params?: ListParams) => ['Sent Back Category', 'list', params ?? {}] as const, // Example
  },

  // For Procurement Orders
  procurementOrders: {
    doc: (docId: string) => ['Procurement Orders', docId] as const,
    list: (params?: POListParams) => ['Procurement Orders', 'list', params ?? {}] as const,
  },

  // For Service Requests
  serviceRequests: {
    doc: (docId: string) => ['Service Requests', docId] as const,
    list: (params?: SRListParams) => ['Service Requests', 'list', params ?? {}] as const,
  },

  // For Project Payments
  projectPayments: {
    list: (params?: PaymentListParams) => ['Project Payments', 'list', params ?? {}] as const,
    // Add doc if needed later
  },

  // For Project Inflows
  projectInflows: {
    list: (params?: InflowListParams) => ['Project Inflows', 'list', params ?? {}] as const,
    // Add doc if needed later
  },
  // For Project Inflows
  projectInvoices: {
    list: (params?: ProjectInvoiceParams) => ['Project Invoices', 'list', params ?? {}] as const,
    // Add doc if needed later
  },
  expenseTypes: {
    list: (params?: ExpenseTypeListParams) => ['Expense Type', 'list', params ?? {}] as const,
  },
  nonProjectExpenses: {
    list: (params?: NonProjectExpenseListParams) => ['Non Project Expenses', 'list', params ?? {}] as const,
  },
  projectExpenses: {
    list: (params?: ProjectExpenseListParams) => ['Project Expenses', 'list', params ?? {}] as const,
  },
  doc: (doctype: string, docId: string) => [doctype, 'get', docId] as const,
  docList: (doctype: string) => [doctype, 'list'] as const,

  targetRates: (prId: string, itemIds: string[]) => ['nirmaan_stack.api.target_rates.get_target_rates_for_item_list.get_target_rates_for_item_list', prId, itemIds] as const,

};

// --- Helper Functions for Report Options ---

// PO Reports Tab Options
export const getPOReportListOptions = (): POListParams => ({
  fields: PO_REPORT_FIELDS,
  filters: [["status", "in", ["Dispatched", "Partially Delivered", "Delivered"]]],
  limit: 100000, // Consider pagination in future if needed
  orderBy: { field: 'creation', order: 'desc' },
});

export const getSRReportListOptions = (): SRListParams => ({
  fields: SR_REPORT_FIELDS,
  filters: [['status', '=', "Approved"]], // Only approved SRs for PO report
  limit: 100000,
  orderBy: { field: 'creation', order: 'desc' },
});

export const getPaymentReportListOptions = (docTypes: ('Procurement Orders' | 'Service Requests')[]): PaymentListParams => ({
  fields: PAYMENT_REPORT_FIELDS,
  // Fetch payments related to POs/SRs and are marked 'Paid' for the PO Report context
  filters: [
    ['document_type', 'in', docTypes],
    ['status', '=', 'Paid'], // Status relevant for PO Report 'Amt Paid'
  ],
  limit: 100000,
});

export const getProjectMinimalListOptions = (projectIds: string[]): ProjectListParams => ({
  fields: PROJECT_MINIMAL_FIELDS,
  filters: projectIds.length > 0 ? [['name', 'in', projectIds]] : [],
  limit: projectIds.length || 1, // Fetch only needed, prevent fetching 0
});

export const getVendorMinimalListOptions = (vendorIds: string[]): VendorListParams => ({
  fields: VENDOR_MINIMAL_FIELDS,
  filters: vendorIds.length > 0 ? [['name', 'in', vendorIds]] : [],
  limit: vendorIds.length || 1,
});


// Project Reports Tab Options
export const getProjectReportListOptions = (): ProjectListParams => ({
  fields: PROJECT_REPORT_FIELDS,
  limit: 10000,
  orderBy: { field: "creation", order: "desc" },
  // Add global filters if needed, e.g., only 'Active' projects
  // filters: [['status', '=', 'Active']]
});

export const getPOForProjectInvoiceOptions = (): POListParams => ({
  fields: ['name', 'project', 'loading_charges', 'freight_charges', 'invoice_data',"total_amount","amount","tax_amount"], // Only fields needed for invoice calc
  filters: [["status", "not in", ["Merged", "Cancelled", "PO Amendment"]]], // Match PO report filters
  limit: 100000,
});

export const getSRForProjectInvoiceOptions = (): SRListParams => ({
  fields: ['name', 'project', 'gst', "service_order_list", 'invoice_data'], // Only fields needed for invoice calc
  filters: [['status', '=', "Approved"]], // Match SR report filters
  limit: 100000,
});

export const getInflowReportListOptions = (): InflowListParams => ({
  fields: INFLOW_REPORT_FIELDS,
  // No project filter here, fetch all and group in the hook
  limit: 100000,
});

export const getProjectInvoiceReportListOptions = (): InflowListParams => ({
  fields: PROJECT_INVOICE_REPORT_FIELDS,
  // No project filter here, fetch all and group in the hook
  limit: 100000,
});

export const getPaidPaymentReportListOptions = (): PaymentListParams => ({
  fields: PAYMENT_REPORT_FIELDS, // Includes 'project' and 'amount'
  // Filter specifically for 'Paid' status for accurate outflow calculation
  filters: [['status', '=', 'Paid']],
  limit: 100000,
});

export const getNonProjectExpenseTypeListOptions = (): ExpenseTypeListParams => ({
  fields: EXPENSE_TYPE_MINIMAL_FIELDS,
  filters: [['non_project', '=', 1]], // Only fetch non-project expense types
  limit: 100000, // Default to a high limit for dropdowns
  orderBy: { field: "expense_name", order: "asc" }, // Default sort by name
});

export const getNonProjectExpenseListOptions = (): NonProjectExpenseListParams => ({
  fields: NON_PROJECT_EXPENSE_DEFAULT_FIELDS,
  limit: 100000, // Default limit for a table, adjust as needed for pagination
  orderBy: { field: "creation", order: "desc" }, // Default sort
});

export const getProjectExpenseTypeListOptions = (): ExpenseTypeListParams => ({
  fields: EXPENSE_TYPE_MINIMAL_FIELDS,
  filters: [['project', '=', 1]], // Only fetch non-project expense types
  limit: 100000, // Default to a high limit for dropdowns
  orderBy: { field: "expense_name", order: "asc" }, // Default sort by name
});

export const getProjectExpenseListOptions = (): NonProjectExpenseListParams => ({
  fields: PROJECT_EXPENSE_DEFAULT_FIELDS,
  limit: 100000, // Default limit for a table, adjust as needed for pagination
  orderBy: { field: "creation", order: "desc" }, // Default sort
});





// --------------------------------------------------------------------------------

// Helper function to generate standardized Frappe options for reuse
export const getCategoryListOptions = (workPackage?: string): CategoryListParams => ({
  fields: ["name", "category_name", "work_package", "tax"], // Specify needed fields
  filters: workPackage ? [["work_package", "=", workPackage]] : [],
  orderBy: { field: "category_name", order: "asc" },
  limit: 10000, // Consider pagination if needed
  workPackage: workPackage, // Include the parameter used in filtering for key uniqueness
});

export const getItemListOptions = (categoryNames?: string[]): ItemListParams => ({
  fields: ["name", "item_name", "make_name", "unit_name", "category", "creation"],
  filters: categoryNames && categoryNames.length > 0 ? [["category", "in", categoryNames]] : [],
  orderBy: { field: "creation", order: "desc" },
  limit: 100000, // Consider pagination
  categoryNames: categoryNames, // Include the parameter used in filtering for key uniqueness
});



export const getCommentListOptions = (referenceName?: string): CommentListParams => ({
  fields: ["name", "comment_type", "reference_doctype", "reference_name", "comment_by", "content", "subject", "creation"],
  filters: referenceName ? [["reference_name", "=", referenceName]] : [],
  orderBy: { field: "creation", order: "desc" },
  limit: 50, // Example limit for comments
  referenceName: referenceName, // Include the parameter for key uniqueness
});

export const getUsersListOptions = (): ListParams => ({
  fields: ["name", "full_name", "role_profile"],
  limit: 1000,
  // Add filters here if needed, e.g., role_profile
});

export const getQuoteListOptions = (): ListParams => ({
  fields: ["item_id", "quote"],
  limit: 100000,
});

export const getVendorListOptions = (vendorType: string[] = ["Material", "Material & Service"]): VendorListParams => ({
  fields: ["vendor_name", "vendor_type", "name", "vendor_city", "vendor_state"],
  filters: vendorType.length > 0 ? [["vendor_type", "in", vendorType]] : [],
  limit: 10000,
  orderBy: { field: "vendor_name", order: "asc" },
  vendorType: vendorType, // Include for key uniqueness
});

export const getProjectListOptions = (projectOptions?: { filters?: Filter<FrappeDoc<Projects>>[], fields?: string[] }): ProjectListParams => ({
  fields: projectOptions?.fields || PROJECT_MINIMAL_FIELDS,
  filters: projectOptions?.filters || [],
  limit: 1000,
  orderBy: { field: "project_name", order: "asc" },
});

export const getCustomerListOptions = (customerOptions?: { filters?: Filter<FrappeDoc<Customers>>[] }): CustomerListParams => ({
  fields: CUSTOMER_MINIMAL_FIELDS,
  filters: customerOptions?.filters || [],
  limit: 1000,
  orderBy: { field: "company_name", order: "asc" },
});



// Helper for Approved Quotations options (adjust fields/limits as needed)
export const getApprovedQuotationOptions = (): ListParams => ({
  fields: ['name', 'item_id', 'quote', 'creation', 'procurement_order', 'vendor', 'quantity', 'unit', 'item_name'], // Add fields needed for 3-month lowest calc
  limit: 100000, // Be mindful of performance with large datasets
});