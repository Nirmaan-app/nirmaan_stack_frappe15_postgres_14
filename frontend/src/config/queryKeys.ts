// Define interfaces for filter objects to ensure consistency
interface ListParams {
  fields?: string[];
  filters?: (string | number | boolean | string[])[][];
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

  // For Projects (used in Container)
  projects: {
      doc: (docId: string) => ['Projects', docId] as const,
  },

  vendors: {
    list: (params?: VendorListParams) => ['Vendors', 'list', params ?? {}] as const,
    // detail: (vendorId: string) => ['Vendors', 'detail', vendorId] as const,
},

sentBackCategory: {
  doc: (docId: string) => ['Sent Back Category', docId] as const,
  // list: (params?: ListParams) => ['Sent Back Category', 'list', params ?? {}] as const, // Example
},

};

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

// Helper for Approved Quotations options (adjust fields/limits as needed)
export const getApprovedQuotationOptions = (): ListParams => ({
  fields: ['name', 'item_id', 'quote', 'creation', 'procurement_order', 'vendor', 'quantity', 'unit', 'item_name'], // Add fields needed for 3-month lowest calc
  limit: 100000, // Be mindful of performance with large datasets
});