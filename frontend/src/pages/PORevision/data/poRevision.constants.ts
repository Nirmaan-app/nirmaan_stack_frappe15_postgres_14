// ─── PO Revision Doctype Constants ────────────────────────────
export const PO_REVISION_DOCTYPE = "PO Revisions";
export const PO_REVISION_ITEMS_DOCTYPE = "PO Revisions Items";

// ─── SWR Cache Key Factory (Standardized) ─────────────────────
export const poRevisionKeys = {
  // Revision documents
  revisionDoc: (id: string) => ["po-revision", "doc", id] as const,
  revisionHistory: (poId: string) =>
    ["po-revision", "history", poId] as const,

  // Context data (for the revision dialog)
  project: (projectId: string) =>
    ["po-revision", "project", projectId] as const,
  procurementRequest: (prId: string) =>
    ["po-revision", "pr", prId] as const,
  vendorInvoices: (poId: string) =>
    ["po-revision", "invoices", poId] as const,

  // Approval context
  originalPO: (poId: string) => ["po-revision", "originalPO", poId] as const,

  // Lock check
  lockCheck: (poId: string) => ["po-revision", "lockCheck", poId] as const,
  allLocked: () => ["po-revision", "allLocked"] as const,
};

// ─── Backend API Endpoints ────────────────────────────────────
export const PO_REVISION_APIS = {
  makeRevision:
    "nirmaan_stack.api.po_revisions.revision_logic.make_po_revisions",
  approveRevision:
    "nirmaan_stack.api.po_revisions.revision_logic.on_approval_revision",
  checkLock:
    "nirmaan_stack.api.po_revisions.revision_po_check.check_po_in_pending_revisions",
  getHistory:
    "nirmaan_stack.api.po_revisions.revision_history.get_po_revision_history",
  getAllLocked:
    "nirmaan_stack.api.po_revisions.revision_po_check.get_all_locked_po_names",
} as const;
