import { describe, expect, it } from "vitest";

import {
    BATCH_COMPLETED,
    BATCH_COMPLETED_WITH_EXCEPTIONS,
    BATCH_DRAFT,
    BATCH_IN_REVIEW,
    BATCH_PARTIALLY_SETTLED,
    EXCEPTION_ROW_STATUSES,
    OPEN_ROW_STATUSES,
    ROW_AMOUNT_MISMATCH,
    ROW_CONTROL_EXCEPTION,
    ROW_ERROR,
    ROW_PENDING,
    ROW_RECONCILED,
    ROW_REFERENCE_MISMATCH,
    ROW_SETTLED,
    ROW_SKIPPED,
    ROW_STATUSES,
    ROW_STATUS_TONE,
    ROW_UNMATCHED,
    TERMINAL_ROW_STATUSES,
    deriveBatchCounters,
    deriveBatchStatus,
    isException,
    isOpen,
    isTerminal,
    rowStatusTone,
} from "./outflowImportStatus";

/**
 * FE half of the FE<->BE parity pin (ADR-0010 F1).
 *
 * The Python half lives in `services/outflow_import/test_status.py::TestVocabularyParity` and
 * asserts the SAME literal list. Neither test can import the other's language, so the pin is that
 * both name the vocabulary explicitly: change one side alone and the other side's test fails.
 *
 * Why this is worth a test at all -- an unmirrored status does not crash. It arrives from the
 * server, misses `ROW_STATUS_TONE`, and renders as unstyled grey text that looks deliberate.
 */
describe("row status vocabulary (parity with services/outflow_import/status.py)", () => {
    it("is exactly these nine statuses", () => {
        expect(ROW_STATUSES).toEqual([
            "Pending",
            "Reconciled",
            "Amount mismatch",
            "Reference mismatch",
            "Control exception",
            "Unmatched",
            "Settled",
            "Skipped",
            "Error",
        ]);
    });

    it("partitions cleanly into terminal and open", () => {
        for (const status of ROW_STATUSES) {
            expect(isTerminal(status) || isOpen(status)).toBe(true);
            expect(isTerminal(status) && isOpen(status)).toBe(false);
        }
        expect(TERMINAL_ROW_STATUSES.size + OPEN_ROW_STATUSES.size).toBe(ROW_STATUSES.length);
    });

    it("treats every read-only finding as terminal", () => {
        // Reporting them WAS the job -- they need nothing further from anyone.
        for (const status of [
            ROW_RECONCILED,
            ROW_AMOUNT_MISMATCH,
            ROW_REFERENCE_MISMATCH,
            ROW_CONTROL_EXCEPTION,
        ]) {
            expect(isTerminal(status)).toBe(true);
        }
    });

    it("treats Unmatched and Error as open", () => {
        // Unmatched is expense work nobody has done; Error must be retried.
        expect(isOpen(ROW_UNMATCHED)).toBe(true);
        expect(isOpen(ROW_ERROR)).toBe(true);
    });

    it("counts exactly the three exception states", () => {
        expect([...EXCEPTION_ROW_STATUSES].sort()).toEqual(
            ["Amount mismatch", "Control exception", "Reference mismatch"].sort()
        );
    });

    it("gives every status a tone", () => {
        for (const status of ROW_STATUSES) {
            expect(ROW_STATUS_TONE[status]).toBeTruthy();
        }
    });

    it("falls back to a neutral tone for an unknown status rather than rendering nothing", () => {
        expect(rowStatusTone("Something New")).toBeTruthy();
    });

    it("reserves red for Error alone", () => {
        // Error is the only status meaning the software failed rather than the data disagreed.
        const red = ROW_STATUSES.filter((s) => ROW_STATUS_TONE[s].includes("red"));
        expect(red).toEqual([ROW_ERROR]);
    });

    it("gives the three exception states one shared tone", () => {
        // Different findings, same call to action. Separate colours would imply a severity
        // ranking the design does not have.
        const tones = new Set([...EXCEPTION_ROW_STATUSES].map((s) => ROW_STATUS_TONE[s]));
        expect(tones.size).toBe(1);
    });
});

describe("deriveBatchStatus", () => {
    it("is Draft with no rows", () => {
        expect(deriveBatchStatus([])).toBe(BATCH_DRAFT);
    });

    it("is In Review while nothing is terminal", () => {
        expect(deriveBatchStatus([ROW_PENDING, ROW_PENDING])).toBe(BATCH_IN_REVIEW);
    });

    it("is Partially Settled when some rows are terminal and some are not", () => {
        expect(deriveBatchStatus([ROW_SETTLED, ROW_PENDING])).toBe(BATCH_PARTIALLY_SETTLED);
    });

    it("is Completed when every row is terminal", () => {
        expect(deriveBatchStatus([ROW_RECONCILED, ROW_SETTLED, ROW_SKIPPED])).toBe(BATCH_COMPLETED);
    });

    it("is Completed on a batch of nothing but reported findings", () => {
        // There is nothing to settle -- the findings ARE the output.
        expect(deriveBatchStatus([ROW_CONTROL_EXCEPTION, ROW_AMOUNT_MISMATCH])).toBe(
            BATCH_COMPLETED
        );
    });

    it("is Completed with exceptions only when force-closed over open rows", () => {
        expect(deriveBatchStatus([ROW_SETTLED, ROW_UNMATCHED], true)).toBe(
            BATCH_COMPLETED_WITH_EXCEPTIONS
        );
        expect(deriveBatchStatus([ROW_SETTLED], true)).toBe(BATCH_COMPLETED);
    });
});

describe("deriveBatchCounters", () => {
    it("partitions the rows the same way the backend does", () => {
        const counters = deriveBatchCounters([
            ROW_PENDING,
            ROW_RECONCILED,
            ROW_SETTLED,
            ROW_SKIPPED,
            ROW_CONTROL_EXCEPTION,
            ROW_AMOUNT_MISMATCH,
            ROW_ERROR,
        ]);
        expect(counters).toEqual({
            total_rows: 7,
            reviewed_rows: 6,
            reconciled_rows: 1,
            settled_rows: 1,
            skipped_rows: 1,
            exception_rows: 2,
            error_rows: 1,
        });
    });

    it("counts an empty batch as zero", () => {
        expect(deriveBatchCounters([]).total_rows).toBe(0);
    });

    it("counts every non-Pending row as reviewed", () => {
        const statuses = ROW_STATUSES.filter((s) => s !== ROW_PENDING);
        expect(deriveBatchCounters(statuses).reviewed_rows).toBe(statuses.length);
    });
});

describe("isException", () => {
    it("is true for the three findings and false for everything else", () => {
        expect(isException(ROW_AMOUNT_MISMATCH)).toBe(true);
        expect(isException(ROW_REFERENCE_MISMATCH)).toBe(true);
        expect(isException(ROW_CONTROL_EXCEPTION)).toBe(true);
        expect(isException(ROW_RECONCILED)).toBe(false);
        expect(isException(ROW_SKIPPED)).toBe(false);
    });
});
