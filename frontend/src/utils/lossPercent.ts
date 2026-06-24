// Single source of truth for the "high loss" rule used across PR/SB
// vendor-quote selection (Send for Approval) and the PR/SB approval screens.
//
// Loss % is measured against the SAME benchmark the existing Savings/Loss column
// uses (Target Amount when available, else Lowest Quoted L1). A justification is
// REQUIRED when Loss % is strictly greater than LOSS_THRESHOLD_PERCENT.

export const LOSS_THRESHOLD_PERCENT = 10;

/**
 * Loss % of an item versus its benchmark, derived from the already-computed
 * `savingLoss` (= benchmark - amount; negative means a loss).
 *
 * Returns the loss magnitude as a positive percentage, or 0 when there is a
 * saving (savingLoss >= 0) or no usable benchmark.
 */
export function computeLossPercent(
  savingLoss: number | undefined,
  benchmark: number | undefined
): number {
  if (!benchmark || benchmark <= 0) return 0;
  if (savingLoss === undefined || savingLoss >= 0) return 0;
  return (-savingLoss / benchmark) * 100;
}

/** Whether an item's loss requires a justification (strictly > threshold). */
export function isHighLoss(lossPercent: number | undefined): boolean {
  return (lossPercent ?? 0) > LOSS_THRESHOLD_PERCENT;
}
