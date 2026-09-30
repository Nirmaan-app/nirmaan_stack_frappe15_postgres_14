/**
 * What kind of payment a `Project Payments` row is (ADR-0030; glossary: CONTEXT.md, "GST payment").
 */

/**
 * Is this a GST payment — one that pays a Work Order's GST only, never base value?
 *
 * `Project Payments.is_gst_payment`, set once at creation; every older payment reads 0 (a base
 * payment). ⚠️ MIRRORS `payment_tds.is_gst_payment` ON THE SERVER, which is what refuses the tax;
 * the screens read it to tag the payment and to keep the TDS forecast from promising a deduction
 * that will never be taken.
 */
export const isGstPayment = (payment: { is_gst_payment?: unknown } | null | undefined): boolean => {
	const flag = payment?.is_gst_payment;
	return flag === true || Number(flag) === 1;
};
