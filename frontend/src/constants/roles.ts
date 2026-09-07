/**
 * Role-profile constants — the ONE owning module for "which role profiles count as X".
 *
 * ADR-0010 F1: a domain rule has one home. Before this file the procurement role
 * profile was written inline at ~90 call sites, which is why adding
 * `Nirmaan Procurement Lead Profile` (a real Role Profile with a real user, but a
 * string the frontend had never heard of) meant an empty sidebar and an empty
 * dashboard for that user.
 *
 * Mirrored server-side by `nirmaan_stack/services/role_profiles.py`. Keep the two
 * in sync — the backend is the enforcement boundary, this layer is UX.
 */

export const PROCUREMENT_EXECUTIVE_PROFILE = "Nirmaan Procurement Executive Profile";
export const PROCUREMENT_LEAD_PROFILE = "Nirmaan Procurement Lead Profile";
export const MATERIAL_PROCUREMENT_EXECUTIVE_PROFILE =
  "Nirmaan Material Procurement Executive Profile";
export const SERVICE_PROCUREMENT_EXECUTIVE_PROFILE =
  "Nirmaan Service Procurement Executive Profile";

/**
 * Procurement splits by WHAT IS BOUGHT, and the split is a VIEW split, not an
 * access boundary (owner ruling): a narrowed profile stops seeing the other
 * side's nav items, but its routes stay reachable and the server still answers.
 * Do not read these sets as security.
 *
 * Material = the PR -> PO chain and everything downstream of a material buy
 * (products, inventory, warehouse, transfers, delivery).
 * Service  = Work Orders, i.e. Service Requests, and the WO rate card.
 *
 * The two legacy profiles sit in BOTH sets on purpose:
 *   - Procurement Executive predates the split and keeps seeing everything, so
 *     the four existing users are untouched until they are migrated by hand.
 *   - Procurement Lead leads both sides.
 */
export const MATERIAL_PROCUREMENT_PROFILES: readonly string[] = [
  PROCUREMENT_EXECUTIVE_PROFILE,
  PROCUREMENT_LEAD_PROFILE,
  MATERIAL_PROCUREMENT_EXECUTIVE_PROFILE,
];

export const SERVICE_PROCUREMENT_PROFILES: readonly string[] = [
  PROCUREMENT_EXECUTIVE_PROFILE,
  PROCUREMENT_LEAD_PROFILE,
  SERVICE_PROCUREMENT_EXECUTIVE_PROFILE,
];

/**
 * Every profile carrying procurement access — the UNION, and the DEFAULT.
 *
 * This name and meaning are deliberately unchanged by the material/service
 * split: a shared surface (Projects, Vendors, Payments, Reports, BoQ upload)
 * belongs to every procurement person, and those call sites should keep reading
 * this set. Only material-only and service-only surfaces get narrowed.
 *
 * The direction matters. Defaulting to the union means a site someone forgets
 * to narrow shows one stray nav item -- it can never lock a user out of their
 * own job. Defaulting to a narrow set would fail the other way round.
 */
export const PROCUREMENT_PROFILES: readonly string[] = [
  PROCUREMENT_EXECUTIVE_PROFILE,
  PROCUREMENT_LEAD_PROFILE,
  MATERIAL_PROCUREMENT_EXECUTIVE_PROFILE,
  SERVICE_PROCUREMENT_EXECUTIVE_PROFILE,
];

/** Any procurement profile. The default for a SHARED surface. */
export const isProcurementProfile = (role?: string | null): boolean =>
  !!role && PROCUREMENT_PROFILES.includes(role);

/** Sees the material side (PR/PO and downstream). */
export const isMaterialProcurementProfile = (role?: string | null): boolean =>
  !!role && MATERIAL_PROCUREMENT_PROFILES.includes(role);

/** Sees the service side (Work Orders / Service Requests). */
export const isServiceProcurementProfile = (role?: string | null): boolean =>
  !!role && SERVICE_PROCUREMENT_PROFILES.includes(role);

export const BILLING_EXECUTIVE_PROFILE = "Nirmaan Billing Executive Profile";
export const BILLING_LEAD_PROFILE = "Nirmaan Billing Lead Profile";

/**
 * The billing desk. Distinct from Accountant (`Nirmaan Accountant Profile` /
 * `Nirmaan Accountant Lead Profile`), which owns the INVOICE side of a PO —
 * these two own the billing-document side.
 *
 * Note billing is otherwise a VIEW-ONLY profile on a PO: `PurchaseOrder.tsx`
 * folds Billing Executive into `estimatesViewing`, which hides Upload DC/MIR.
 * DC/MIR deletion is a deliberate exception (owner ruling) — billing is the
 * desk that catches a wrong or duplicate DC/MIR, so it must be able to remove
 * one without also gaining upload rights.
 */
export const BILLING_PROFILES: readonly string[] = [
  BILLING_EXECUTIVE_PROFILE,
  BILLING_LEAD_PROFILE,
];

/** Any billing profile. */
export const isBillingProfile = (role?: string | null): boolean =>
  !!role && BILLING_PROFILES.includes(role);

export const ADMIN_PROFILE = "Nirmaan Admin Profile";
export const PMO_EXECUTIVE_PROFILE = "Nirmaan PMO Executive Profile";
export const PROJECT_LEAD_PROFILE = "Nirmaan Project Lead Profile";
export const PROJECT_MANAGER_PROFILE = "Nirmaan Project Manager Profile";

/**
 * May delete a DC / MIR off a PO — admin, procurement (they file them) and
 * billing (they catch the bad ones). Mirrored server-side by
 * `role_profiles.PDD_DELETE_PROFILES`, which is the ENFORCEMENT boundary;
 * this constant only decides whether the trash icon renders.
 */
export const PDD_DELETE_PROFILES: readonly string[] = [
  ADMIN_PROFILE,
  ...PROCUREMENT_PROFILES,
  ...BILLING_PROFILES,
];

/** True when `role` (a role PROFILE) may delete a DC / MIR. */
export const canDeleteDeliveryDocument = (
  role?: string | null,
  userId?: string | null
): boolean =>
  userId === "Administrator" || (!!role && PDD_DELETE_PROFILES.includes(role));

/**
 * May act on the "Pending Invoice Approvals" queue — approve, reject, or re-run
 * the auto-approve gates on an invoice stuck behind a stale reason.
 *
 * Mirrored server-side by `role_profiles.INVOICE_APPROVAL_PROFILES`, which is
 * the ENFORCEMENT boundary; this constant only decides whether the controls
 * render. It also mirrors the inline list in `InvoiceReconciliationContainer`
 * that gates the Pending tab itself — a reviewer who cannot see the queue must
 * not be offered a button that sweeps it.
 */
const INVOICE_APPROVAL_PROFILES: readonly string[] = [
  ADMIN_PROFILE,
  PMO_EXECUTIVE_PROFILE,
  "Nirmaan Accountant Profile",
  "Nirmaan Accountant Lead Profile",
];

/** True when `role` (a role PROFILE) may action pending invoice approvals. */
export const canActionInvoiceApprovals = (
  role?: string | null,
  userId?: string | null
): boolean =>
  userId === "Administrator" ||
  (!!role && INVOICE_APPROVAL_PROFILES.includes(role));

/**
 * May see Target Progress in the Work Report: the Target column beside Actual,
 * and the "With / Without Target Progress" choice in the DPR download dialog.
 *
 * Admin + PMO Executive + Project Lead. It was Admin-only; PMO was added first,
 * then Project Lead.
 *
 * PROJECT MANAGER IS DELIBERATELY OUT (owner ruling, corrected after it was
 * briefly included). A PM records the work actually done on site; the target
 * they are measured against is the Lead's view, not theirs. Do not add
 * `PROJECT_MANAGER_PROFILE` here on the assumption it was an oversight.
 *
 * The rule lived as THREE identical `isAdmin` copies -- one each in
 * `MilestonesSummary`, `MilestoneDailySummary` and `PDFDownloadButtons` -- which
 * had to change together or the Work Report would offer a Target column the
 * download dialog would not honour. One home now; do not re-inline it.
 *
 * SCOPE: Target Progress and nothing else. Every other permission on those
 * screens keeps its own gate (`canDeleteReport`, for one, already included PMO
 * and is untouched). Do not widen this predicate to stand for "is privileged".
 */
export const TARGET_PROGRESS_PROFILES: readonly string[] = [
  ADMIN_PROFILE,
  PMO_EXECUTIVE_PROFILE,
  PROJECT_LEAD_PROFILE,
];

/** True when `role` (a role PROFILE) may see Target Progress in the Work Report. */
export const canViewTargetProgress = (
  role?: string | null,
  userId?: string | null
): boolean =>
  userId === "Administrator" ||
  (!!role && TARGET_PROGRESS_PROFILES.includes(role));

// ---------------------------------------------------------------------------
// Route-level access lists (RG-1)
//
// These routes had NO guard: plain `element:` entries under ProtectedRoute, so
// "logged in" was the entire check. Hiding a nav item hid the door, not the
// room -- a bookmark or a pasted URL still opened the page. `RoleRoute` in
// `utils/auth/ProtectedRoute` now gates each with the list below.
//
// Each list is the UNION across every sidebar entry that links to that route.
// Several are reachable from more than one entry with different role sets
// (Customers sits in Admin Options AND on the Accountant sidebar; Project
// Invoices sits in the Accountant block AND the Sales block). A route list is
// therefore WIDER than any single sidebar array by design -- narrowing it to
// one of them would lock out a role whose nav item still points here.
//
// The hardcoded "Administrator" user always passes and is never listed.
// UI gate only; no server-side role check backs these.
// ---------------------------------------------------------------------------

const ACCOUNTANT_PROFILE = "Nirmaan Accountant Profile";
const ACCOUNTANT_LEAD_PROFILE = "Nirmaan Accountant Lead Profile";
const ESTIMATES_EXECUTIVE_PROFILE = "Nirmaan Estimates Executive Profile";
const SALES_EXECUTIVE_PROFILE = "Nirmaan Sales Executive Profile";
const SALES_LEAD_PROFILE = "Nirmaan Sales Lead Profile";

/** `/customers` -- Admin Options entry plus the Accountant sidebar entry. */
export const CUSTOMERS_ACCESS: readonly string[] = [
  ADMIN_PROFILE,
  ACCOUNTANT_PROFILE,
  ACCOUNTANT_LEAD_PROFILE,
];

/** `/upload-boq` and its hub / revision / sheet children. PMO excluded. */
export const UPLOAD_BOQ_ACCESS: readonly string[] = [
  ADMIN_PROFILE,
  ...PROCUREMENT_PROFILES,
  ESTIMATES_EXECUTIVE_PROFILE,
  PROJECT_LEAD_PROFILE,
];

/**
 * `/upload-boq/templates`. NARROWER than UPLOAD_BOQ_ACCESS -- the templates
 * editor is Admin + Estimates only. It gets its own guard because it shares the
 * `upload-boq` path prefix: folding it into the wizard's wrapper would WIDEN it
 * to procurement and Project Lead, who have never had it.
 */
export const BOQ_TEMPLATES_ACCESS: readonly string[] = [
  ADMIN_PROFILE,
  ESTIMATES_EXECUTIVE_PROFILE,
];

/** `/project-invoices` -- Accountant block plus the Sales block. PMO excluded. */
export const PROJECT_INVOICES_ACCESS: readonly string[] = [
  ADMIN_PROFILE,
  ACCOUNTANT_PROFILE,
  ACCOUNTANT_LEAD_PROFILE,
  SALES_EXECUTIVE_PROFILE,
  SALES_LEAD_PROFILE,
];
