/**
 * VAV-2b2 QR-MARK (b) -- owner 2026-11-21 15:56 "3b"; UI CHANGE CONTROL item 13. TEMPORARY: the next slice removes this file and
 * its use with a test that the line is gone. A declared hand-written test run (its run id starts STUB-VAV-2b2-) wrote answers for
 * the VAV rows of 11 sheets; every row the VAV helper prices on such a run says so in one amber line. Nothing in a stored answer
 * carries a mark; an ordinary run never shows it.
 */
export const STUB_RUN_PREFIX = "STUB-VAV-2b2-";
export const STUB_RUN_LINE = "These answers were written by hand for a test, not read by the model.";

/** PURE. The line for a row priced by `categoryId` on the run `runId`, or null. */
export function stubRunLineOf(runId: string | null | undefined, categoryId: string): string | null {
  return typeof runId === "string" && runId.startsWith(STUB_RUN_PREFIX) && categoryId === "hvac_vav_box" ? STUB_RUN_LINE : null;
}
