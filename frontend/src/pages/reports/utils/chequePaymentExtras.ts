import { ProjectPayments } from "@/types/NirmaanStack/ProjectPayments";

/**
 * Cheque Payment report: the figures that do NOT live on the payment row, read for a given set
 * of rows only (the visible page, or the export) -- never a whole-doctype lookup.
 *
 *   - the parent PO / WO's status and money (`document_name` is a Dynamic Link, which the list
 *     query cannot join);
 *   - the TDS withheld, from `Payment TDS Deduction.project_payment` (the real link -- the
 *     payment's own `payment_tds` is a mirror);
 *   - how many live payments share each cheque number (one cheque may cover several payments,
 *     keyed on the number alone exactly like `reference_guard.cheque_siblings_of`).
 */

export type ChequePaymentRow = ProjectPayments & {
    project_name?: string;
    vendor_name?: string;
    on_hold?: number;
    /** Set on export rows only; the screen reads the page-level map instead. */
    extras?: ChequeExtras;
};

export interface OrderFigures {
    status?: string;
    total_amount: number;
    amount_paid: number;
    amount_invoiced: number;
}

export interface ChequeExtras {
    order?: OrderFigures;
    tds: number;
    /** Non-rejected payments carrying this cheque number, this one included. 0 when unknown. */
    chequePaymentCount: number;
}

/** POST `frappe.client.get_list` with no page limit. */
export type ListDocs = (
    doctype: string,
    fields: string[],
    filters: unknown[],
) => Promise<Record<string, unknown>[]>;

/** Keeps every `name in (...)` well under the generated-SQL token cap and the request size. */
const CHUNK = 500;

const chunks = <T>(items: T[]): T[][] => {
    const out: T[][] = [];
    for (let i = 0; i < items.length; i += CHUNK) out.push(items.slice(i, i + CHUNK));
    return out;
};

const num = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};

const unique = (values: (string | undefined | null)[]) =>
    [...new Set(values.map((v) => (v || "").trim()).filter(Boolean))];

const listIn = async (
    listDocs: ListDocs,
    doctype: string,
    fields: string[],
    field: string,
    values: string[],
    extra: unknown[] = [],
) => {
    const pages = await Promise.all(
        chunks(values).map((part) => listDocs(doctype, fields, [...extra, [field, "in", part]])),
    );
    return pages.flat();
};

const ORDER_FIELDS = ["name", "status", "total_amount", "amount_paid", "amount_invoiced"];

export const loadChequeExtras = async (
    rows: ChequePaymentRow[],
    listDocs: ListDocs,
): Promise<Map<string, ChequeExtras>> => {
    const extras = new Map<string, ChequeExtras>();
    if (rows.length === 0) return extras;

    const poNames = unique(rows.filter((r) => r.document_type === "Procurement Orders").map((r) => r.document_name));
    const woNames = unique(rows.filter((r) => r.document_type === "Service Requests").map((r) => r.document_name));
    const chequeNos = unique(rows.map((r) => r.cheque_no));

    const [pos, wos, tdsRows, siblings] = await Promise.all([
        listIn(listDocs, "Procurement Orders", ORDER_FIELDS, "name", poNames),
        listIn(listDocs, "Service Requests", ORDER_FIELDS, "name", woNames),
        listIn(listDocs, "Payment TDS Deduction", ["project_payment", "tds_amount"], "project_payment", unique(rows.map((r) => r.name))),
        listIn(listDocs, "Project Payments", ["name", "cheque_no"], "cheque_no", chequeNos, [
            ["mode_of_payment", "=", "Cheque"],
            ["status", "!=", "Rejected"],
        ]),
    ]);

    const toFigures = (d: Record<string, unknown>): OrderFigures => ({
        status: (d.status as string) || undefined,
        total_amount: num(d.total_amount),
        amount_paid: num(d.amount_paid),
        amount_invoiced: num(d.amount_invoiced),
    });
    const orders = new Map<string, OrderFigures>();
    for (const d of [...pos, ...wos]) orders.set(String(d.name), toFigures(d));

    const tdsByPayment = new Map<string, number>();
    for (const t of tdsRows) {
        const key = String(t.project_payment);
        tdsByPayment.set(key, (tdsByPayment.get(key) || 0) + num(t.tds_amount));
    }

    const perCheque = new Map<string, number>();
    for (const s of siblings) {
        const key = String(s.cheque_no || "").trim();
        if (key) perCheque.set(key, (perCheque.get(key) || 0) + 1);
    }

    for (const r of rows) {
        extras.set(r.name, {
            order: orders.get(r.document_name),
            tds: tdsByPayment.get(r.name) || 0,
            chequePaymentCount: perCheque.get((r.cheque_no || "").trim()) || 0,
        });
    }
    return extras;
};
