/**
 * Which document types a Bulk Download offers -- one rule set for the Step 1 cards, the Quick
 * Download menu and the wizard's queries, so they cannot drift apart.
 *
 * A bulk download covers one project (the project page's tab) or one vendor (the vendor page's
 * tab). Role rules are the same in both: a Project Manager gets no vendor invoices, client
 * invoices or payment vouchers; PMO loses client invoices only.
 */
import { PMO_EXECUTIVE_PROFILE, PROJECT_MANAGER_PROFILE } from "@/constants/roles";

export type BulkDocType = "PO" | "WO" | "Invoice" | "DC" | "MIR" | "DN" | "ClientInvoice" | "PaymentVoucher";
export type InvoiceSubType = "PO Invoices" | "WO Invoices" | "All Invoices";
export type BulkScopeKind = "project" | "vendor";

export interface BulkDownloadScope {
    kind: BulkScopeKind;
    id: string;
    /** Project / vendor name, for the copy only (the server names the file itself). */
    name?: string;
    /** Vendor scope only: `Vendors.vendor_type`. */
    vendorType?: string;
}

/** Card and menu order. */
export const BULK_DOC_TYPES: readonly BulkDocType[] = ["PO", "WO", "Invoice", "DC", "MIR", "DN", "ClientInvoice", "PaymentVoucher"];

/**
 * Every name a type goes by, in ONE place: the Step 1 card (`card`, `description`), the Quick
 * Download menu item (`menu`) and the wizard's progress text (`short`). A `Record` over
 * `BulkDocType`, so a new type without an entry fails the build.
 */
export const TYPE_INFO: Record<BulkDocType, { card: string; description: string; menu: string; short: string }> = {
    PO: { card: "Procurement Orders", description: "Download selected POs with or without rates", menu: "Download All POs", short: "POs" },
    WO: { card: "Work Orders", description: "Download selected approved WOs / SRs", menu: "Download All WOs", short: "WOs" },
    Invoice: { card: "Vendor Invoices", description: "Download PO invoices, WO invoices, or all", menu: "Download All Vendor Invoices", short: "Invoices" },
    DC: { card: "Delivery Challans", description: "Download selected delivery challan attachments", menu: "Download All DCs", short: "DCs" },
    MIR: { card: "Material Inspection Reports", description: "Download selected MIR attachments", menu: "Download All MIRs", short: "MIRs" },
    DN: { card: "Delivery Notes", description: "Download delivery note PDFs for selected POs", menu: "Download All DNs", short: "DNs" },
    ClientInvoice: { card: "Client Invoices", description: "Download client invoice attachments raised on the project", menu: "Download All Client Invoices", short: "Client Invoices" },
    PaymentVoucher: { card: "Payment Vouchers", description: "Download uploaded vouchers of paid WO payments", menu: "Download All Payment Vouchers", short: "Payment Vouchers" },
};

/** The invoice choices, in display order — read by both the Quick Download dialog and the wizard. */
export const INVOICE_SUB_TYPES: readonly { value: InvoiceSubType; label: string; description: string }[] = [
    { value: "All Invoices", label: "All Invoices", description: "Download all PO and WO invoices together" },
    { value: "PO Invoices", label: "PO Invoices", description: "Only invoices linked to Procurement Orders" },
    { value: "WO Invoices", label: "WO Invoices", description: "Only invoices linked to Work Orders" },
];

// Gated by vendor type the same way the vendor page gates its own tabs.
const MATERIAL_TYPES: readonly BulkDocType[] = ["PO", "DC", "MIR", "DN"];
const SERVICE_TYPES: readonly BulkDocType[] = ["WO", "PaymentVoucher"];

/** The vendor-type rule the vendor page uses for its own tabs too (Material Orders, Work Orders, …). */
export const vendorHandlesMaterial = (vendorType?: string) => vendorType === "Material" || vendorType === "Material & Service";
export const vendorHandlesService = (vendorType?: string) => vendorType === "Service" || vendorType === "Material & Service";

export const allowedBulkTypes = (scope: Pick<BulkDownloadScope, "kind" | "vendorType">, role: string): BulkDocType[] =>
    BULK_DOC_TYPES.filter((type) => {
        if (role === PROJECT_MANAGER_PROFILE && (type === "Invoice" || type === "ClientInvoice" || type === "PaymentVoucher")) return false;
        if (role === PMO_EXECUTIVE_PROFILE && type === "ClientInvoice") return false;
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
