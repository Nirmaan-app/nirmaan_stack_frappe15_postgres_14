import { describe, expect, it } from "vitest";

import {
    BATCH_COMPLETED,
    BATCH_DRAFT,
    BATCH_IN_REVIEW,
    BATCH_PARTIALLY_SETTLED,
    BATCH_STATUSES,
    OPEN_ROW_STATUSES,
    ROW_ERROR,
    ROW_MATCHED,
    ROW_MISMATCHED,
    ROW_PENDING_MATCH,
    ROW_SETTLED,
    ROW_SKIPPED,
    ROW_STATUSES,
    ROW_STATUS_TONE,
    ROW_UNMATCHED,
    TERMINAL_ROW_STATUSES,
    deriveBatchCounters,
    deriveBatchStatus,
    isOpen,
    isTerminal,
    rowStatusTone,
} from "./outflowImportStatus";

/**
 * FE half of the FE<->BE parity pin (ADR-0010 F1).
 *
 * The Python half lives in `services/outflow_import/test_status.py::TestVocabulary` and asserts the
 * SAME literal list. Neither test can import the other's language, so the pin is that both name the
 * vocabulary explicitly: change one side alone and the other side's test fails.
 *
 * Why this is worth a test at all -- an unmirrored status does not crash. It arrives from the
 * server, misses `ROW_STATUS_TONE`, and renders as unstyled grey text that looks deliberate.
 *
 * ⚠️ REWRITTEN AT THE v3 REVERSAL (slice V0), alongside the Python half.
 */
describe("row status vocabulary (parity with services/outflow_import/status.py)", () => {
    it("is exactly these seven statuses, in reviewer order", () => {
        expect(ROW_STATUSES).toEqual([
            "Pending match run",
            "Matched",
            "Unmatched",
            "Mismatched",
            "Settled",
            "Skipped",
            "Error",
        ]);
    });

    it("is exactly these four batch statuses", () => {
        expect(BATCH_STATUSES).toEqual([
            "Draft",
            "In Review",
            "Partially Settled",
            "Completed",
        ]);
    });

    it("no longer carries any retired v2 status", () => {
        // Asserted as absence, not left to a code read: a re-added constant would pass every other
        // test here while the server, whose Select no longer offers it, could never send it.
        for (const retired of [
            "Pending",
            "Reconciled",
            "Amount mismatch",
            "Reference mismatch",
            "Control exception",
        ]) {
            expect(ROW_STATUSES).not.toContain(retired);
            expect(ROW_STATUS_TONE[retired]).toBeUndefined();
        }
        expect(BATCH_STATUSES).not.toContain("Completed with exceptions");
    });

    it("partitions cleanly into terminal and open", () => {
        for (const status of ROW_STATUSES) {
            expect(isTerminal(status) || isOpen(status)).toBe(true);
            expect(isTerminal(status) && isOpen(status)).toBe(false);
        }
        expect(TERMINAL_ROW_STATUSES.size + OPEN_ROW_STATUSES.size).toBe(ROW_STATUSES.length);
    });

    it("treats ONLY Settled and Skipped as terminal", () => {
        // Narrower than v2 on purpose: v2 findings were terminal because reporting them was the
        // whole job. v3 settles, so a row that found something and was never confirmed is work.
        expect([...TERMINAL_ROW_STATUSES].sort()).toEqual([ROW_SETTLED, ROW_SKIPPED].sort());
    });

    it("keeps Matched and Mismatched open so both stay resolvable", () => {
        // Owner ruling: reporting a mismatch with no way to act on it was the defect. Marking
        // either terminal drops it out of every "needs a decision" surface.
        expect(isOpen(ROW_MATCHED)).toBe(true);
        expect(isOpen(ROW_MISMATCHED)).toBe(true);
    });

    it("gives every status a tone, so none renders as accidental grey", () => {
        for (const status of ROW_STATUSES) {
            expect(ROW_STATUS_TONE[status]).toBeTruthy();
            expect(rowStatusTone(status)).toBe(ROW_STATUS_TONE[status]);
        }
    });

    it("falls back to a neutral tone for a status it has never seen", () => {
        expect(rowStatusTone("Something the server invented")).toBe("bg-gray-100 text-gray-700");
    });

    it("reserves red for Error alone", () => {
        // Error is the only status meaning the SOFTWARE failed rather than the data disagreed.
        const red = ROW_STATUSES.filter((s) => ROW_STATUS_TONE[s].includes("red"));
        expect(red).toEqual([ROW_ERROR]);
    });
});

describe("deriveBatchStatus (mirrors status.derive_batch_status)", () => {
    it("is Draft with no rows", () => {
        expect(deriveBatchStatus([])).toBe(BATCH_DRAFT);
    });

    it("is In Review while nothing is terminal", () => {
        expect(deriveBatchStatus([ROW_PENDING_MATCH, ROW_MATCHED, ROW_UNMATCHED])).toBe(
            BATCH_IN_REVIEW
        );
    });

    it("is Partially Settled with a mix", () => {
        expect(deriveBatchStatus([ROW_SETTLED, ROW_UNMATCHED])).toBe(BATCH_PARTIALLY_SETTLED);
    });

    it("is Completed only when every row is settled or skipped", () => {
        expect(deriveBatchStatus([ROW_SETTLED, ROW_SKIPPED])).toBe(BATCH_COMPLETED);
    });

    it("does not call a batch with an unconfirmed match Completed", () => {
        // v2 would have: a found-but-unconfirmed row was terminal there.
        expect(deriveBatchStatus([ROW_SETTLED, ROW_MATCHED])).toBe(BATCH_PARTIALLY_SETTLED);
    });

    it("does not call a batch with an errored row Completed", () => {
        expect(deriveBatchStatus([ROW_SETTLED, ROW_ERROR])).toBe(BATCH_PARTIALLY_SETTLED);
    });
});

describe("deriveBatchCounters (mirrors status.derive_batch_counters)", () => {
    it("reports exactly the keys that are live fields on the batch doctype", () => {
        // An extra key writes nothing and reports nothing, silently -- which is precisely how
        // `reconciled_rows` outlived the status it counted.
        expect(Object.keys(deriveBatchCounters([ROW_SETTLED])).sort()).toEqual(
            ["error_rows", "reviewed_rows", "settled_rows", "skipped_rows", "total_rows"].sort()
        );
    });

    it("counts everything that has left Pending match run as reviewed", () => {
        const counters = deriveBatchCounters([
            ROW_PENDING_MATCH,
            ROW_PENDING_MATCH,
            ROW_MATCHED,
            ROW_SETTLED,
        ]);
        expect(counters.total_rows).toBe(4);
        expect(counters.reviewed_rows).toBe(2);
    });

    it("counts each terminal bucket separately", () => {
        const counters = deriveBatchCounters([
            ROW_SETTLED,
            ROW_SETTLED,
            ROW_SKIPPED,
            ROW_ERROR,
            ROW_MISMATCHED,
        ]);
        expect(counters.settled_rows).toBe(2);
        expect(counters.skipped_rows).toBe(1);
        expect(counters.error_rows).toBe(1);
    });

    it("agrees with deriveBatchStatus about what is finished", () => {
        // The two are read side by side on the list page; a disagreement there reads as a bug in
        // whichever one the reader trusts less.
        const statuses = [ROW_SETTLED, ROW_SKIPPED];
        const counters = deriveBatchCounters(statuses);
        expect(counters.settled_rows + counters.skipped_rows).toBe(statuses.length);
        expect(deriveBatchStatus(statuses)).toBe(BATCH_COMPLETED);
    });
});
