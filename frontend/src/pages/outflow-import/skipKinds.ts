// src/pages/outflow-import/skipKinds.ts
//
// The Skip Type labels the screen reasons about, mirrored from the server's
// `services/outflow_import/skip_kinds.py` and `skip_origin.UNSKIP_LOCKED_KINDS`.
// Pure: no React. `skipKinds.test.ts` reads both Python files and fails if either side drifts.

export const SKIP_KIND_ALREADY_IMPORTED = "Already imported";
export const SKIP_KIND_REPEATED_IN_FILE = "Repeated in same file";
export const SKIP_KIND_BANK_REFUSED = "Bank refused";
export const SKIP_KIND_NO_AMOUNT = "No amount";
export const SKIP_KIND_OUTFLOW_RECORDED = "Outflow Already Recorded";
export const SKIP_KIND_INFLOW_RECORDED = "Inflow Already Recorded";
export const SKIP_KIND_BY_HAND = "Skipped by hand";

/**
 * The kinds a bank-statement rule decided: the line was read as money moving inside the bank or between
 * our own accounts. Unskipping one warns first -- the re-check does not re-apply the rule (owner, B1).
 */
export const BANK_RULE_SKIP_KINDS: ReadonlySet<string> = new Set([
    "Cashfree wallet top-up",
    "Cashbook wallet top-up",
    "Porter wallet top-up",
    "Wallet money returned",
    "Bank internal transfer",
    "Failed payment bounced back",
    "Bank card rounding (₹2)",
    "Credit card bill payment",
    "Credit card auto-debit",
]);

/**
 * The four kinds that stay skipped, with the sentence the disabled Unskip shows (owner, 2026-09-17, A1).
 * The SERVER's `unskip_refusal` is the boundary; this exists so the button explains itself in words.
 */
export const UNSKIP_LOCKED_KINDS: Readonly<Record<string, string>> = {
    [SKIP_KIND_ALREADY_IMPORTED]: "The same transfer is in an earlier statement.",
    [SKIP_KIND_REPEATED_IN_FILE]: "The same transfer appears earlier in this statement.",
    [SKIP_KIND_NO_AMOUNT]: "No money moved on this line.",
    [SKIP_KIND_BANK_REFUSED]: "The bank never moved this money.",
};
