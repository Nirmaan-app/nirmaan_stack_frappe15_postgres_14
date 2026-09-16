/**
 * The payment voucher PDF's download filename: ORDERID_PAYMENTNAME_DATE_UTR.pdf.
 *
 * The UTR part is capped because `Project Payments.utr` is Text and may hold a whole bank
 * narration (#1254); uncapped, the filename outgrows filesystem limits and the download breaks.
 */
export const VOUCHER_UTR_MAX = 40;

export function buildVoucherFilename({
  orderName,
  paymentName,
  datePart,
  utr,
}: {
  orderName: string;
  paymentName: string;
  datePart: string;
  utr?: string | null;
}): string {
  const sanitized = (utr ?? "").replace(/[^a-zA-Z0-9]/g, "").slice(0, VOUCHER_UTR_MAX);
  const utrPart = sanitized ? `_${sanitized}` : "";
  return `${orderName}_${paymentName}_${datePart}_${utrPart}.pdf`;
}
