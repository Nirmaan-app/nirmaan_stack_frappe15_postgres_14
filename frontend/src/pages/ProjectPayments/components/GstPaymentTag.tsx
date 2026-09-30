/**
 * The "GST" tag a payment list shows on a GST payment (ADR-0030): a payment that pays a Work
 * Order's GST only and is never taxed. Renders nothing on a base payment.
 */
import { isGstPayment } from "../paymentKind";

export const GstPaymentTag = ({ payment }: { payment: { is_gst_payment?: unknown } | null | undefined }) =>
	isGstPayment(payment) ? (
		<span
			className="ml-1 inline-block whitespace-nowrap rounded-full bg-violet-50 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700 ring-1 ring-inset ring-violet-200"
			title="GST payment — pays GST only; no TDS is withheld"
		>
			GST
		</span>
	) : null;
