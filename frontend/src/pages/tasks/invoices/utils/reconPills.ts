/**
 * Vendor Invoice Recon's pills (spec #1637): one table for Pending Approval (#1644) and All Invoices (#1646). Each pill
 * names the screens that show it and who sees it there.
 *
 * PO and WO are the Vendor Invoices of one document type. Cashbook and Credit Card are Expense bills; Porter is
 * Porter Invoices. Those three are for the Vendor Invoice approvers only (Admin, Accountant, Accountant Lead), as the
 * server checks.
 */
import { canActionInvoiceApprovals } from "@/constants/roles";

export type ReconScreen = "pending" | "all";

const everyone = () => true;

/** Every pill of Vendor Invoice Recon, in the order the bar shows them. */
export const RECON_PILLS = [
    { key: "po", label: "PO", kind: "vendor", documentType: "Procurement Orders", screens: ["pending", "all"], visibleTo: everyone },
    { key: "wo", label: "WO", kind: "vendor", documentType: "Service Requests", screens: ["pending", "all"], visibleTo: everyone },
    { key: "cashbook", label: "Cashbook", kind: "expense", screens: ["pending", "all"], visibleTo: canActionInvoiceApprovals },
    { key: "card", label: "Credit Card", kind: "expense", screens: ["pending", "all"], visibleTo: canActionInvoiceApprovals },
    { key: "porter", label: "Porter", kind: "porter", screens: ["all"], visibleTo: canActionInvoiceApprovals },
] as const satisfies readonly ({
    key: string;
    label: string;
    screens: readonly ReconScreen[];
    visibleTo: (role?: string | null, userId?: string | null) => boolean;
} & ({ kind: "vendor"; documentType: string } | { kind: "expense" | "porter" }))[];

export type ReconPill = (typeof RECON_PILLS)[number];
export type ReconPillKey = ReconPill["key"];

/** Whether `value` (a URL param) names one of `RECON_PILLS`. */
export const isReconPillKey = (value: string): value is ReconPillKey => RECON_PILLS.some((p) => p.key === value);

/** The pills `screen` shows to `role`, in order. */
export const reconPillsFor = (screen: ReconScreen, role?: string | null, userId?: string | null): ReconPill[] =>
    RECON_PILLS.filter((p) => (p.screens as readonly ReconScreen[]).includes(screen) && p.visibleTo(role, userId));
