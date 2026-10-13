/**
 * How much "Adjust Payments" may offer to resolve (#1400, ADR-0032).
 *
 * The ledger's extra amount paid (`|remaining_impact|`) is what the PO claims; the server spends only
 * its usable credit: capped at what was really overpaid, less what waiting Vendor Refunds hold. The
 * dialog offers the smaller of the two, so it never offers money the server will refuse or a refund
 * has already promised. With no `usableCredit` (an older backend) it falls back to the claim.
 */
export function creditOnOffer(remainingImpact: number, usableCredit?: number): number {
  if (remainingImpact >= 0) return 0;
  const claimed = Math.abs(remainingImpact);
  return usableCredit === undefined ? claimed : Math.max(0, Math.min(claimed, usableCredit));
}
