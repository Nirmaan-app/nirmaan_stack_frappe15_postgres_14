/**
 * One TDS register row's two parties: what the tax was withheld ON, and who it was withheld FROM
 * (spec #1522, #1525).
 *
 * ⚠️ "TDS" HERE IS TAX DEDUCTED AT SOURCE, not a Technical Data Sheet.
 *
 * A `Payment TDS Deduction` names exactly one source (`services/payment_tds.deduction_link_problem`):
 * a Work Order payment (`project_payment`, section 194C), whose deductee is its vendor, or an Office
 * Rent expense (`non_project_expense`, section 194-I), whose deductee is the landlord snapshotted on
 * the row (`deductee_name`, `deductee_pan`). The register shows the landlord where a Work Order row
 * shows the vendor, and the expense where it shows the payment.
 */

import { PaymentTDSDeduction } from "@/types/NirmaanStack/PaymentTDSDeduction";

type RowParties = Pick<
    PaymentTDSDeduction,
    "project_payment" | "non_project_expense" | "vendor" | "deductee_name" | "deductee_pan"
>;

/** What the tax was withheld on: a payment, an expense, or nothing (a row that breaks the one-source rule). */
export type TdsRowSource = { kind: "payment" | "expense"; name: string } | null;

export const tdsRowSource = (row: RowParties): TdsRowSource => {
    if (row.project_payment) return { kind: "payment", name: row.project_payment };
    if (row.non_project_expense) return { kind: "expense", name: row.non_project_expense };
    return null;
};

/** Who the tax was withheld from: the landlord on an expense row, else the vendor (by id). */
export type TdsDeductee =
    | { kind: "landlord"; name: string; pan: string | null }
    | { kind: "vendor"; vendor: string }
    | null;

export const tdsDeductee = (row: RowParties): TdsDeductee => {
    if (row.non_project_expense || row.deductee_name || row.deductee_pan) {
        const name = (row.deductee_name || "").trim();
        const pan = (row.deductee_pan || "").trim() || null;
        return name || pan ? { kind: "landlord", name: name || "--", pan } : null;
    }
    return row.vendor ? { kind: "vendor", vendor: row.vendor } : null;
};

/** The deductee as one line, for the CSV: "Asha Rao (PAN ABCPK1234D)", the vendor's name, or "--". */
export const tdsDeducteeText = (row: RowParties, vendorName: (vendorId: string) => string): string => {
    const deductee = tdsDeductee(row);
    if (!deductee) return "--";
    if (deductee.kind === "vendor") return vendorName(deductee.vendor);
    return deductee.pan ? `${deductee.name} (PAN ${deductee.pan})` : deductee.name;
};

/** The deductee's ID, GST and PAN for the register's own columns. A vendor row reads the vendor's current
 *  GST and PAN (joined by the list query); a landlord row has no vendor ID or GST, and its PAN is the one
 *  snapshotted on the row. */
export const tdsDeducteeIds = (
    row: RowParties & { vendor_gst?: string | null; vendor_pan?: string | null }
): { id: string | null; gst: string | null; pan: string | null } => {
    const deductee = tdsDeductee(row);
    if (deductee?.kind === "landlord") return { id: null, gst: null, pan: deductee.pan };
    return { id: row.vendor || null, gst: row.vendor_gst || null, pan: row.vendor_pan || null };
};
