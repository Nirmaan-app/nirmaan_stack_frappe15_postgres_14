import { ProjectPayments } from "@/types/NirmaanStack/ProjectPayments";

/**
 * Whether a payment carries an uploaded voucher. An emptied field counts as none: deleting a
 * voucher leaves "" behind (the report's IS_SET aggregate and Frappe's `is set` agree).
 */
export const hasVoucher = (p: Pick<ProjectPayments, "voucher_attachment">) => !!p.voucher_attachment;
