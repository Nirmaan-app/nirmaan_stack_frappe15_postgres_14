import {
  useFrappeGetDocList, useFrappeGetDoc, useFrappeGetDocCount, useFrappeGetCall, FrappeDoc, GetDocListArgs,
} from "frappe-react-sdk";
import { Projects } from "@/types/NirmaanStack/Projects";
import { ProcurementRequest } from "@/types/NirmaanStack/ProcurementRequests";
import { Category } from "@/types/NirmaanStack/Category";
import { VendorInvoice } from "@/types/NirmaanStack/VendorInvoice";
import { Items } from "@/types/NirmaanStack/Items";
import { Vendors } from "@/types/NirmaanStack/Vendors";
import { VENDOR_DOCTYPE } from "../vendors.constants";
import { useEffect, useRef } from "react";
import { captureApiError } from "@/utils/sentry/captureApiError";


// ─── Vendor Cache Keys (Standardized) ─────────────────────────

export const vendorKeys = {
  projects: () => ["vendor", "projects"] as const,
  procurementRequests: () => ["vendor", "procurementRequests"] as const,
  categories: () => ["vendor", "categories"] as const,
  invoices: (vendorId: string) => ["vendor", "invoices", vendorId] as const,
  items: () => ["vendor", "items"] as const,
  docCount: () => ["vendor", "docCount"] as const,
  ledgerDoc: (vendorId: string) => ["vendor", "ledgerDoc", vendorId] as const,
  ledgerData: (vendorId: string) => ["vendor", "ledgerData", vendorId] as const,
  serviceRequestsApproved: (vendorId: string) => ["vendor", "serviceRequestsApproved", vendorId] as const,
  serviceRequestsFinalized: (vendorId: string) => ["vendor", "serviceRequestsFinalized", vendorId] as const,
  vendorDoc: (vendorId?: string) => ["vendor", "doc", vendorId] as const,
  vendorAddress: (addressId?: string) => ["vendor", "Address", addressId] as const,
  existingVendors: (excludeId?: string) => ["vendor", "existingVendors", excludeId] as const,
  pincode: (pincode?: string) => ["vendor", "pincode", pincode] as const,
  bankDetails: (ifsc?: string) => ["vendor", "bankDetails", ifsc] as const,
  categoryList: (orderBy?: { field: string; order: "asc" | "desc" }) =>
    ["vendor", "categoryList", orderBy?.field ?? null, orderBy?.order ?? null] as const,
};

// ─── Interfaces ──────────────────────────────────────────────
interface VendorDoc {
  vendor_type: "Material" | "Service" | "Material & Service";
  sr_amount_balance: number;
  po_amount_balance: number;
  invoice_balance: number;
  payment_balance: number;
  vendor_name: string;
}
interface ApiTransaction {
  type:
  | "PO Created"
  | "SR Created"
  | "Invoice Recorded"
  | "Payment Made"
  | "Refund Received"
  | "Credit Note Recorded";
  date: string;
  project: string;
  details: string;
  amount: number;
  payment: number;
}
interface LoggerOptions {
  hook: string;
  api: string;
  feature: string;
  doctype?: string;
  entity_id?: string;
}

export const useApiErrorLogger = (error: any, options: LoggerOptions) => {
  const lastErrorIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!error) return;
    const currentErrorId = [
      options.feature,
      options.hook,
      options.api,
      options.doctype ?? "",
      options.entity_id ?? "",
      error?.message ?? "",
      error?.httpStatus ?? "",
    ].join("|");

    if (lastErrorIdRef.current === currentErrorId) return;
    lastErrorIdRef.current = currentErrorId;

    captureApiError({
      hook: options.hook,
      api: options.api,
      feature: options.feature,
      doctype: options.doctype,
      entity_id: options.entity_id,
      error: error,
    });
  }, [error, options.hook, options.api, options.feature, options.doctype, options.entity_id]);
};

// ─── Queries ─────────────────────────────────────────────────

export const useVendorProjects = () => {
  const response = useFrappeGetDocList<Projects>("Projects",
    { fields: ["name", "project_name"], limit: 0 },
    vendorKeys.projects()
  ); 
  useApiErrorLogger(response.error, {
    hook: "useVendorProjects",
    api: "Projects List",
    feature: "vendor",
  });
  return response;
};

export const useVendorProcurementRequests = () => {
  const response = useFrappeGetDocList<ProcurementRequest>("Procurement Requests",
    { fields: ["name", "work_package"], limit: 0 },
    vendorKeys.procurementRequests()
  );
  useApiErrorLogger(response.error, {
    hook: "useVendorProcurementRequests",
    api: "Procurement Requests",
    feature: "vendor",
  });
  return response;
};

export const useVendorCategories = () => {
  const response = useFrappeGetDocList<Category>("Category",
    { fields: ["name", "work_package", "category_name"], limit: 0 },
    vendorKeys.categories()
  );
  useApiErrorLogger(response.error, {
    hook: "useVendorCategories",
    api: "Categories",
    feature: "vendor",
  });
  return response;
};

export const useVendorServiceRequestCounts = (vendorId: string) => {
  const approvedResponse = useFrappeGetDocList("Service Requests",
    {
      filters: [
        ["status", "=", "Approved"],
        ["is_finalized", "=", 0],
        ["vendor", "=", vendorId],
      ],
      fields: ["name"],
      limit: 1000,
    },
    vendorId ? vendorKeys.serviceRequestsApproved(vendorId) : null
  );
  const finalizedResponse = useFrappeGetDocList("Service Requests",
    {
      filters: [
        ["status", "=", "Approved"],
        ["is_finalized", "=", 1],
        ["vendor", "=", vendorId],
      ],
      fields: ["name"],
      limit: 1000,
    },
    vendorId ? vendorKeys.serviceRequestsFinalized(vendorId) : null
  );
  useApiErrorLogger(approvedResponse.error, {
    hook: "useVendorServiceRequestCounts",
    api: "Service Requests Approved",
    feature: "vendor",
    doctype: "Service Requests",
    entity_id: vendorId,
  });
  useApiErrorLogger(finalizedResponse.error, {
    hook: "useVendorServiceRequestCounts",
    api: "Service Requests Finalized",
    feature: "vendor",
    doctype: "Service Requests",
    entity_id: vendorId,
  });
  return {
    approvedSRs: approvedResponse.data || [],
    finalizedSRs: finalizedResponse.data || [],
    isLoading: approvedResponse.isLoading || finalizedResponse.isLoading,
    error: approvedResponse.error || finalizedResponse.error,
    mutate: async () => {
      await Promise.all([approvedResponse.mutate(), finalizedResponse.mutate()]);
    },
  };
};

export const useVendorInvoices = (vendorId: string) => {
  const response = useFrappeGetDocList<VendorInvoice>("Vendor Invoices",
    {
      filters: [
        ["vendor", "=", vendorId],
        ["document_type", "=", "Procurement Orders"],
        ["status", "=", "Approved"],
      ],
      fields: ["name", "document_name", "invoice_amount"],
      limit: 0,
    } as GetDocListArgs<FrappeDoc<VendorInvoice>>,
    vendorKeys.invoices(vendorId)
  );
  useApiErrorLogger(response.error, {
    hook: "useVendorInvoices",
    api: "Vendor Invoices",
    feature: "vendor",
    doctype: "Vendor Invoice",
    entity_id: vendorId,
  });
  return response;
};

export const useVendorItems = () => {
  const response = useFrappeGetDocList<Items>(
    "Items",
    { fields: ["name", "item_name"], limit: 0 },
    vendorKeys.items()
  );
  useApiErrorLogger(response.error, {
    hook: "useVendorItems",
    api: "Items",
    feature: "vendor",
  });
  return response;
};

export const useVendorDocCount = () => {
  const response = useFrappeGetDocCount(
    VENDOR_DOCTYPE,
    undefined,
    false,
    vendorKeys.docCount()
  );
  useApiErrorLogger(response.error, {
    hook: "useVendorDocCount",
    api: "Vendor Doc Count",
    feature: "vendor",
  });
  return response;
};

export const useLedgerVendorDoc = (vendorId: string) => {
  const response = useFrappeGetDoc<VendorDoc>('Vendors', vendorId, vendorKeys.ledgerDoc(vendorId));
  useApiErrorLogger(response.error,
    {
      hook: "useLedgerVendorDoc",
      api: "Vendor Doc",
      feature: "vendor",
    });
  return response
};

export const useLedgerData = (vendorId: string) => {
  const response = useFrappeGetCall<{ message: ApiTransaction[] }>(
    "nirmaan_stack.api.vendor.get_vendor_po_invoices.get_po_ledger_data",
    { vendor_id: vendorId },
    vendorKeys.ledgerData(vendorId)
  );
  useApiErrorLogger(response.error, {
    hook: "useLedgerData",
    api: "get_po_ledger_data",
    feature: "vendor",
    entity_id: vendorId,
  });
  return response;
};

export const useEditVendorData = (id: string | undefined) => {
  const vendorResponse = useFrappeGetDoc("Vendors",
    id,
    id ? vendorKeys.vendorDoc(id) : null
  );
  const addressId = vendorResponse.data?.vendor_address;
  const addressResponse = useFrappeGetDoc(
    "Address",
    addressId,
    addressId ? vendorKeys.vendorAddress(addressId) : null,
    { revalidateIfStale: false }
  );
  useApiErrorLogger(vendorResponse.error, {
    hook: "useEditVendorData",
    api: "Get Vendor",
    feature: "vendor",
    doctype: "Vendors",
    entity_id: id,
  });
  useApiErrorLogger(addressResponse.error, {
    hook: "useEditVendorData",
    api: "Get Vendor Address",
    feature: "vendor",
    doctype: "Address",
    entity_id: vendorResponse.data?.vendor_address,
  });
  return {
    data: vendorResponse.data,
    vendorMutate: vendorResponse.mutate,
    vendorAddress: addressResponse.data,
    addressMutate: addressResponse.mutate,
  };
};

export const useExistingVendors = (excludeId?: string) => {
  const filters: any[] = excludeId ? [["name", "!=", excludeId]] : [];
  const response = useFrappeGetDocList<Vendors>("Vendors",
    {
      fields: ["vendor_gst"],
      filters: filters.length > 0 ? filters : undefined,
      limit: 10000,
    },
    vendorKeys.existingVendors(excludeId)
  );
  useApiErrorLogger(response.error, {
    hook: "useExistingVendors",
    api: "Vendors",
    feature: "vendor",
  });
  return response;
};

export const usePincodeData = (pincode: string) => {
  const shouldFetch = pincode?.length >= 6;
  const response = useFrappeGetDoc(
    "Pincodes",
    pincode,
    shouldFetch ? vendorKeys.pincode(pincode) : null
  );
  useApiErrorLogger(response.error, {
    hook: "usePincodeData",
    api: "Pincode Data",
    feature: "vendor",
  });
  return response;
};


export const useBankDetails = (ifsc: string) => {
  const response = useFrappeGetCall(
    "nirmaan_stack.api.bank_details.generate_bank_details",
    { ifsc_code: ifsc },
    ifsc?.length === 11 ? vendorKeys.bankDetails(ifsc) : null
  );
  useApiErrorLogger(response.error, {
    hook: "useBankDetails",
    api: "Bank Details",
    feature: "vendor",
  });
  return response;
};

export const useCategoryList = (orderBy?: {field: string; order: "asc" | "desc" }) => {
  const response = useFrappeGetDocList("Category",
    {
      fields: ["*"],
      filters: [["work_package", "!=", "Services"]],
      ...(orderBy ? { orderBy } : {}),
      limit: 10000,
    },
    vendorKeys.categoryList(orderBy)
  );
  useApiErrorLogger(response.error, {
    hook: "useCategoryList",
    api: "Category List",
    feature: "vendor",
  });

  return response;
};
