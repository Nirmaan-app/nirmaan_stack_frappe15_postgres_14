// ─── PO Adjustment Doctype Constants ────────────────────────────
export const PO_ADJUSTMENT_DOCTYPE = "PO Adjustments";
export const PO_ADJUSTMENT_ITEMS_DOCTYPE = "PO Adjustment Items";

// ─── SWR Cache Key Factory ──────────────────────────────────────
export const poAdjustmentKeys = {
  adjustmentDoc: (poId: string) =>
    ["po-adjustment", "doc", poId] as const,
  candidatePOs: (vendor: string) =>
    ["po-adjustment", "candidatePOs", vendor] as const,
};

// ─── Backend API Endpoints ──────────────────────────────────────
export const PO_ADJUSTMENT_APIS = {
  getAdjustment:
    "nirmaan_stack.api.po_adjustments.adjustment_logic.get_po_adjustment",
  executeAdjustment:
    "nirmaan_stack.api.po_adjustments.adjustment_logic.execute_adjustment",
  getCandidatePOs:
    "nirmaan_stack.api.po_adjustments.adjustment_logic.get_adjustment_candidate_pos",
} as const;
