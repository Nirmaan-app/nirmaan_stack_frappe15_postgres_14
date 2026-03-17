import {
  useFrappeGetDocList,
  useFrappeGetDoc,
  useFrappePostCall,
  FrappeDoc,
  GetDocListArgs,
} from "frappe-react-sdk";
import { ProcurementOrder } from "@/types/NirmaanStack/ProcurementOrders";
import { ProcurementRequest } from "@/types/NirmaanStack/ProcurementRequests";
import { Category } from "@/types/NirmaanStack/Category";
import { Items } from "@/types/NirmaanStack/Items";
import { CategoryMakelist } from "@/types/NirmaanStack/CategoryMakelist";
import { VendorInvoice } from "@/types/NirmaanStack/VendorInvoice";
import { useApiErrorLogger } from "@/utils/sentry/useApiErrorLogger";
import { poRevisionKeys, PO_REVISION_DOCTYPE, PO_REVISION_APIS } from "./poRevision.constants";
import useSWR from "swr";

// ─── Revision Document ───────────────────────────────────────

export const useRevisionDoc = (revisionId?: string) => {
  const response = useFrappeGetDoc(
    PO_REVISION_DOCTYPE,
    revisionId || "",
    revisionId ? poRevisionKeys.revisionDoc(revisionId) : null
  );
  useApiErrorLogger(response.error, {
    hook: "useRevisionDoc",
    api: "PO Revisions GetDoc",
    feature: "po-revision",
    doctype: PO_REVISION_DOCTYPE,
    entity_id: revisionId,
  });
  return response;
};

// ─── Original PO (for approval context) ──────────────────────

export const useOriginalPO = (poId?: string) => {
  const response = useFrappeGetDoc<ProcurementOrder>(
    "Procurement Orders",
    poId || "",
    poId ? poRevisionKeys.originalPO(poId) : null
  );
  useApiErrorLogger(response.error, {
    hook: "useOriginalPO",
    api: "Procurement Orders GetDoc",
    feature: "po-revision",
    doctype: "Procurement Orders",
    entity_id: poId,
  });
  return response;
};

// ─── Procurement Request (for work package context) ──────────

export const useProcurementRequestForRevision = (prId?: string) => {
  const response = useFrappeGetDoc<ProcurementRequest>(
    "Procurement Requests",
    prId || "",
    prId ? poRevisionKeys.procurementRequest(prId) : null
  );
  useApiErrorLogger(response.error, {
    hook: "useProcurementRequestForRevision",
    api: "Procurement Requests GetDoc",
    feature: "po-revision",
    doctype: "Procurement Requests",
    entity_id: prId,
  });
  return response;
};

// ─── Categories by Work Package ──────────────────────────────

export const useRevisionCategories = (workPackage?: string) => {
  const response = useFrappeGetDocList<Category>(
    "Category",
    {
      fields: ["name", "tax", "work_package"],
      filters: [
        [
          "work_package",
          "in",
          [workPackage || "NOT YET DEFINED", "Tool & Equipments", "Additional Charges"],
        ],
      ],
      limit: 0,
    },
    poRevisionKeys.categories(workPackage || "default")
  );
  useApiErrorLogger(response.error, {
    hook: "useRevisionCategories",
    api: "Category List",
    feature: "po-revision",
    doctype: "Category",
  });
  return response;
};

// ─── Items by Categories ─────────────────────────────────────

export const useRevisionItems = (
  workPackage: string | undefined,
  categoryNames: string[]
) => {
  const response = useFrappeGetDocList<Items>(
    "Items",
    {
      fields: ["name", "item_name", "category", "unit_name", "make_name"],
      filters:
        categoryNames.length > 0
          ? [["category", "in", categoryNames]]
          : [["name", "=", "INVALID"]],
      limit: 0,
    },
    categoryNames.length > 0
      ? poRevisionKeys.items(workPackage || "default")
      : null
  );
  useApiErrorLogger(response.error, {
    hook: "useRevisionItems",
    api: "Items List",
    feature: "po-revision",
    doctype: "Items",
  });
  return response;
};

// ─── Category Makelist ───────────────────────────────────────

export const useRevisionCategoryMakelist = (
  workPackage: string | undefined,
  categoryNames: string[]
) => {
  const response = useFrappeGetDocList<CategoryMakelist>(
    "Category Makelist",
    {
      fields: ["category", "make"],
      filters:
        categoryNames.length > 0
          ? [["category", "in", categoryNames]]
          : [["category", "=", "INVALID"]],
      limit: 0,
    },
    categoryNames.length > 0
      ? poRevisionKeys.categoryMakelist(workPackage || "default")
      : null
  );
  useApiErrorLogger(response.error, {
    hook: "useRevisionCategoryMakelist",
    api: "Category Makelist",
    feature: "po-revision",
    doctype: "Category Makelist",
  });
  return response;
};

// ─── Vendor Invoices (for dialog context) ────────────────────

export const useRevisionVendorInvoices = (
  poId: string | undefined,
  enabled: boolean = true
) => {
  const response = useFrappeGetDocList<VendorInvoice>(
    "Vendor Invoices",
    {
      fields: [
        "name",
        "invoice_no",
        "invoice_date",
        "invoice_amount",
        "status",
        "owner",
      ],
      filters: [
        ["document_type", "=", "Procurement Orders"],
        ["document_name", "=", poId || ""],
      ],
      limit: 100,
    } as GetDocListArgs<FrappeDoc<VendorInvoice>>,
    enabled && poId ? poRevisionKeys.vendorInvoices(poId) : null
  );
  useApiErrorLogger(response.error, {
    hook: "useRevisionVendorInvoices",
    api: "Vendor Invoices List",
    feature: "po-revision",
    doctype: "Vendor Invoices",
    entity_id: poId,
  });
  return response;
};

// ─── Approval Invoices (for approval detail page) ────────────

export const useApprovalInvoices = (poId?: string) => {
  const response = useFrappeGetDocList(
    "Vendor Invoices",
    {
      fields: [
        "name",
        "invoice_no",
        "invoice_date",
        "invoice_amount",
        "status",
        "uploaded_by",
        "owner",
      ],
      filters: poId
        ? [
            ["document_type", "=", "Procurement Orders"],
            ["document_name", "=", poId],
          ]
        : [],
      limit: 1000,
    },
    poId ? poRevisionKeys.approvalInvoices(poId) : null
  );
  useApiErrorLogger(response.error, {
    hook: "useApprovalInvoices",
    api: "Approval Vendor Invoices",
    feature: "po-revision",
    doctype: "Vendor Invoices",
    entity_id: poId,
  });
  return response;
};

// ─── Categories & Packages (for custom items) ───────────────

export const useProcurementPackages = () => {
  const response = useFrappeGetDocList("Procurement Packages", {
    fields: ["*"],
    filters: [["name", "!=", "Services"]],
    orderBy: { field: "name", order: "asc" },
    limit: 100,
  });
  useApiErrorLogger(response.error, {
    hook: "useProcurementPackages",
    api: "Procurement Packages List",
    feature: "po-revision",
    doctype: "Procurement Packages",
  });
  return response;
};

export const useCategories = () => {
  const response = useFrappeGetDocList("Category", {
    fields: ["*"],
    filters: [["work_package", "!=", "Services"]],
    orderBy: { field: "category_name", order: "asc" },
    limit: 10000,
  });
  useApiErrorLogger(response.error, {
    hook: "useCategories",
    api: "Category List",
    feature: "po-revision",
    doctype: "Category",
  });
  return response;
};

// ─── PO Lock Check ───────────────────────────────────────────

interface POLockCheckResult {
  is_locked: boolean;
  revision_name?: string;
  is_item_locked?: boolean;
  is_payment_locked?: boolean;
  payment_lock_source?: string; // "PO Revision" | "PO Adjustment"
  role?: string;
  revision_id?: string;
  [key: string]: any;
}

export const usePOLockCheck = (poId: string | undefined) => {
  const { call } = useFrappePostCall(PO_REVISION_APIS.checkLock);

  const { data, isLoading, error, mutate } = useSWR<POLockCheckResult | null>(
    poId ? poRevisionKeys.lockCheck(poId) : null,
    () => call({ po_id: poId }).then((res) => res.message || null)
  );

  useApiErrorLogger(error, {
    hook: "usePOLockCheck",
    api: "check_po_in_pending_revisions",
    feature: "po-revision",
    entity_id: poId,
  });

  return { data, isLoading, error, mutate };
};

// ─── Bulk PO Lock Check ──────────────────────────────────────

export const useAllLockedPOs = () => {
  const { call } = useFrappePostCall(PO_REVISION_APIS.getAllLocked);

  const { data, isLoading, error, mutate } = useSWR(
    poRevisionKeys.allLocked(),
    () => call({}).then((res) => res.message || [])
  );

  useApiErrorLogger(error, {
    hook: "useAllLockedPOs",
    api: "get_all_locked_po_names",
    feature: "po-revision",
  });

  return { data, isLoading, error, mutate };
};

// ─── Revision History ────────────────────────────────────────

export const useRevisionHistory = (poId: string) => {
  const { call } = useFrappePostCall(PO_REVISION_APIS.getHistory);

  const { data, isLoading, error, mutate } = useSWR(
    poId ? poRevisionKeys.revisionHistory(poId) : null,
    () => call({ po_id: poId }).then((res) => res.message || [])
  );

  useApiErrorLogger(error, {
    hook: "useRevisionHistory",
    api: "get_po_revision_history",
    feature: "po-revision",
    entity_id: poId,
  });

  return { data: data as any[] | undefined, isLoading, error, mutate };
};
