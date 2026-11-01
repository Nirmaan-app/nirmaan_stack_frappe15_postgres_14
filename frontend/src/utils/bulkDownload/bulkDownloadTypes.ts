/**
 * Which document types a Bulk Download offers -- one rule set for the Step 1 cards, the Quick
 * Download menu and the wizard's queries, so they cannot drift apart.
 *
 * A bulk download covers one project (the project page's tab), one vendor (the vendor page's tab)
 * or every project the user may read (Reports > Bulk Download, the "all" scope). Role rules are the
 * same in all three: a Project Manager gets no vendor invoices, client invoices or payment vouchers
 * (PO or WO). PMO gets every type, client invoices included (PMO views all client money, owner
 * 2026-10-27).
 */
import { PROJECT_MANAGER_PROFILE } from "@/constants/roles";

export type BulkDocType = "PO" | "WO" | "Invoice" | "DC" | "MIR" | "DN" | "MTC" | "ClientInvoice" | "POPaymentVoucher" | "WOPaymentVoucher" | "PorterInvoice";
export type InvoiceSubType = "PO Invoices" | "WO Invoices" | "All Invoices";
export type BulkScopeKind = "project" | "vendor" | "all";

export interface BulkDownloadScope {
    kind: BulkScopeKind;
    /** The project or vendor id; "" for the all scope. */
    id: string;
    /** Project / vendor name, for the copy only (the server names the file itself). */
    name?: string;
    /** Vendor scope only: `Vendors.vendor_type`. */
    vendorType?: string;
}

/** Card order. */
export const BULK_DOC_TYPES: readonly BulkDocType[] = ["PO", "WO", "Invoice", "DC", "MIR", "DN", "MTC", "ClientInvoice", "POPaymentVoucher", "WOPaymentVoucher", "PorterInvoice"];

/** The Quick Download menu's sections, in menu order. Every type sits in exactly one (a test holds it). */
export const MENU_GROUPS: readonly { label: string; types: readonly BulkDocType[] }[] = [
    { label: "Orders", types: ["PO", "WO"] },
    { label: "Delivery & Quality", types: ["DC", "MIR", "DN", "MTC"] },
    { label: "Finance", types: ["Invoice", "ClientInvoice", "POPaymentVoucher", "WOPaymentVoucher", "PorterInvoice"] },
];

/** The menu's sections holding only the allowed `types`; a section left empty is dropped. */
export const menuGroups = (types: readonly BulkDocType[]) =>
    MENU_GROUPS
        .map(({ label, types: inGroup }) => ({ label, types: inGroup.filter((t) => types.includes(t)) }))
        .filter((group) => group.types.length > 0);

/**
 * Every name a type goes by, in ONE place: the Step 1 card and the Quick Download menu item
 * (`card`, plus the card's `description`) and the short form in the progress window's "All …"
 * (`short`). A `Record` over `BulkDocType`, so a new type without an entry fails the build.
 */
export const TYPE_INFO: Record<BulkDocType, { card: string; description: string; short: string }> = {
    PO: { card: "Procurement Orders", description: "Download selected POs with or without rates", short: "POs" },
    WO: { card: "Work Orders", description: "Download selected approved WOs / SRs", short: "WOs" },
    Invoice: { card: "Vendor Invoices", description: "Download PO invoices, WO invoices, or all", short: "Invoices" },
    DC: { card: "Delivery Challans", description: "Download selected delivery challan attachments", short: "DCs" },
    MIR: { card: "Material Inspection Reports", description: "Download selected MIR attachments", short: "MIRs" },
    DN: { card: "Delivery Notes", description: "Download delivery note PDFs for selected POs", short: "DNs" },
    MTC: { card: "Material Test Certificates", description: "Download selected material test certificates", short: "MTCs" },
    ClientInvoice: { card: "Client Invoices", description: "Download client invoice attachments raised on the project", short: "Client Invoices" },
    // PO payments have no uploaded voucher: the server generates each one, as the PO page does.
    POPaymentVoucher: { card: "PO Payment Vouchers", description: "Download generated vouchers of paid PO payments", short: "PO Payment Vouchers" },
    WOPaymentVoucher: { card: "WO Payment Vouchers", description: "Download uploaded vouchers of paid WO payments", short: "WO Payment Vouchers" },
    // Report Bulk Download only: one row per Porter invoice PDF (one PDF covers many trips).
    PorterInvoice: { card: "Porter Invoices", description: "Porter delivery invoices from the monthly Porter statement", short: "Porter Invoices" },
};

/**
 * The order of Material Test Certificates: oldest certificate date first, then oldest upload. A
 * certificate WITHOUT a date (older rows, from before the date was required) goes LAST -- the same
 * order the server merges them in (`bulk_download._mtc_files`: PostgreSQL's ascending order puts
 * NULL last), so the wizard lists them in the order the PDF holds them.
 */
export const compareMtcs = (
    a: { certificate_date?: string | null; creation: string },
    b: { certificate_date?: string | null; creation: string },
): number => {
    const da = a.certificate_date || null;
    const db = b.certificate_date || null;
    if (da !== db) {
        if (!da) return 1;
        if (!db) return -1;
        return da.localeCompare(db);
    }
    return a.creation.localeCompare(b.creation);
};

/** The invoice choices, in display order — read by both the Quick Download dialog and the wizard. */
export const INVOICE_SUB_TYPES: readonly { value: InvoiceSubType; label: string; description: string }[] = [
    { value: "All Invoices", label: "All Invoices", description: "Download all PO and WO invoices together" },
    { value: "PO Invoices", label: "PO Invoices", description: "Only invoices linked to Procurement Orders" },
    { value: "WO Invoices", label: "WO Invoices", description: "Only invoices linked to Work Orders" },
];

// Gated by vendor type the same way the vendor page gates its own tabs.
// MTCs and PO payment vouchers belong to POs, so they follow the PO-side types.
const MATERIAL_TYPES: readonly BulkDocType[] = ["PO", "DC", "MIR", "DN", "MTC", "POPaymentVoucher"];
const SERVICE_TYPES: readonly BulkDocType[] = ["WO", "WOPaymentVoucher"];
const VOUCHER_TYPES: readonly BulkDocType[] = ["POPaymentVoucher", "WOPaymentVoucher"];

/** The vendor-type rule the vendor page uses for its own tabs too (Material Orders, Work Orders, …). */
export const vendorHandlesMaterial = (vendorType?: string) => vendorType === "Material" || vendorType === "Material & Service";
export const vendorHandlesService = (vendorType?: string) => vendorType === "Service" || vendorType === "Material & Service";

export const allowedBulkTypes = (scope: Pick<BulkDownloadScope, "kind" | "vendorType">, role: string): BulkDocType[] =>
    BULK_DOC_TYPES.filter((type) => {
        // Porter invoices belong to no project or vendor: Report Bulk Download (the all scope) only.
        if (type === "PorterInvoice" && scope.kind !== "all") return false;
        if (role === PROJECT_MANAGER_PROFILE && (type === "Invoice" || type === "ClientInvoice" || type === "PorterInvoice" || VOUCHER_TYPES.includes(type))) return false;
        if (scope.kind === "vendor") {
            // Project Invoices carry no vendor.
            if (type === "ClientInvoice") return false;
            if (MATERIAL_TYPES.includes(type) && !vendorHandlesMaterial(scope.vendorType)) return false;
            if (SERVICE_TYPES.includes(type) && !vendorHandlesService(scope.vendorType)) return false;
        }
        return true;
    });

/** A single-type vendor has only one kind of invoice, so the other choice is dropped. */
export const invoiceSubTypesFor = (scope: Pick<BulkDownloadScope, "kind" | "vendorType">): InvoiceSubType[] => {
    const dropped: InvoiceSubType | null =
        scope.kind !== "vendor" ? null
            : !vendorHandlesService(scope.vendorType) ? "WO Invoices"
                : !vendorHandlesMaterial(scope.vendorType) ? "PO Invoices"
                    : null;
    return INVOICE_SUB_TYPES.map((t) => t.value).filter((value) => value !== dropped);
};

/**
 * The facet column of the selection tables: a project's documents span vendors, a vendor's span
 * projects. `title` also goes into the search placeholder.
 */
export const scopeFacet = (kind: BulkScopeKind) =>
    kind === "vendor" ? ({ id: "project", title: "Project" } as const) : ({ id: "vendor", title: "Vendor" } as const);

/**
 * Every facet column the scope's tables filter on (column id -> title). The all scope spans projects
 * AND vendors, so it filters on both; Project and Vendor start empty, so the table opens on everything.
 * `title` goes into the search placeholder.
 */
export const scopeFacets = (kind: BulkScopeKind): { columns: Record<string, string>; title: string } => {
    if (kind === "all") return { columns: { project: "Project", vendor: "Vendor" }, title: "Project or Vendor" };
    const facet = scopeFacet(kind);
    return { columns: { [facet.id]: facet.title }, title: facet.title };
};

/** "this project" / "this vendor" / "your projects" -- for the tables' empty messages. */
export const scopeNoun = (kind: BulkScopeKind) =>
    kind === "all" ? "your projects" : `this ${kind}`;

/**
 * The all scope's table: one download takes at most `ALL_SCOPE_MAX_ITEMS` (the server holds the
 * same number, `bulk_download.ALL_SCOPE_MAX_ITEMS`) and the table pages its rows (thousands per
 * type). The project and vendor tabs keep neither: unpaged, no limit.
 */
export const ALL_SCOPE_MAX_ITEMS = 500;
export const ALL_SCOPE_PAGE_SIZE = 50;

export interface BulkTableLimits {
    pageSize?: number;
    maxSelect?: number;
}

export const bulkTableLimits = (kind: BulkScopeKind): BulkTableLimits =>
    kind === "all" ? { pageSize: ALL_SCOPE_PAGE_SIZE, maxSelect: ALL_SCOPE_MAX_ITEMS } : {};

/** True when a selection is over the scope's limit, so its Download stays disabled. */
export const isOverSelectionLimit = (selectedCount: number, limits: BulkTableLimits) =>
    limits.maxSelect != null && selectedCount > limits.maxSelect;
