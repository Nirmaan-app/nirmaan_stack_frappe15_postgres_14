import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  PENDING_STATUSES,
  SETTLED_STATUSES,
  STATUS_PAID,
  STATUS_RECONCILIATION_PENDING,
  STATUS_SEQUENCE,
  isPending,
  isSettled,
  settledFilter,
  statusLabel,
} from "./settlement";

const PY_SOURCE = readFileSync(
  resolve(__dirname, "../../../nirmaan_stack/services/settlement.py"),
  "utf-8"
);

describe("parity with settlement.py", () => {
  it("reads the real Python module", () => {
    expect(PY_SOURCE).toContain("SETTLED_STATUSES");
  });

  it("the settled set is the SAME two statuses in both", () => {
    const m = PY_SOURCE.match(
      /^SETTLED_STATUSES\s*=\s*\(STATUS_RECONCILIATION_PENDING,\s*STATUS_PAID\)/m
    );
    expect(m, "SETTLED_STATUSES shape changed in settlement.py").toBeTruthy();
    expect([...SETTLED_STATUSES]).toEqual([
      STATUS_RECONCILIATION_PENDING,
      STATUS_PAID,
    ]);
  });

  it("the two status STRINGS match the Python literals", () => {
    expect(PY_SOURCE).toMatch(
      /^STATUS_RECONCILIATION_PENDING\s*=\s*"Reconciliation Pending"/m
    );
    expect(PY_SOURCE).toMatch(/^STATUS_PAID\s*=\s*"Paid"/m);
    expect(STATUS_RECONCILIATION_PENDING).toBe("Reconciliation Pending");
    expect(STATUS_PAID).toBe("Paid");
  });

  it("the owner's labels match the Python ones", () => {
    for (const [status, label] of [
      ["Requested", "Payment Pending Approval"],
      ["CEO Pending", "Payment Pending CEO Approval"],
      ["Approved", "Payment need to paid"],
      [STATUS_RECONCILIATION_PENDING, "Payment Done / Reconciliation Pending"],
      [STATUS_PAID, "Payment Done / Reconciliation Done"],
    ] as const) {
      expect(PY_SOURCE, `label for ${status}`).toContain(`"${label}"`);
      expect(statusLabel(status)).toBe(label);
    }
  });
});

describe("the settled set", () => {
  it("BOTH statuses are settled — `Paid` alone is the old, now-wrong answer", () => {
    expect(isSettled(STATUS_RECONCILIATION_PENDING)).toBe(true);
    expect(isSettled(STATUS_PAID)).toBe(true);
    expect(SETTLED_STATUSES).toHaveLength(2);
  });

  it("nothing before the money moves is settled", () => {
    for (const s of ["Requested", "CEO Pending", "Approved", "Rejected"]) {
      expect(isSettled(s), s).toBe(false);
    }
  });

  it("blank and unknown are not settled", () => {
    for (const s of [null, undefined, "", "   ", "Scheduled"]) {
      expect(isSettled(s), String(s)).toBe(false);
    }
  });

  it("tolerates whitespace — status is a free-text Data field", () => {
    expect(isSettled("  Paid  ")).toBe(true);
    expect(isSettled(" Reconciliation Pending")).toBe(true);
  });
});

describe("the two sets do not overlap", () => {
  it("settled and pending are DISJOINT", () => {
    const overlap = (SETTLED_STATUSES as readonly string[]).filter((s) =>
      (PENDING_STATUSES as readonly string[]).includes(s)
    );
    expect(overlap).toEqual([]);
  });

  it("Reconciliation Pending is NOT pending — that money is spent", () => {
    expect(isPending(STATUS_RECONCILIATION_PENDING)).toBe(false);
  });
});

describe("helpers", () => {
  it("settledFilter replaces a `status = Paid` filter", () => {
    expect(settledFilter()).toEqual([
      "status",
      "in",
      [STATUS_RECONCILIATION_PENDING, STATUS_PAID],
    ]);
  });

  it("unknown labels pass through rather than blanking", () => {
    expect(statusLabel("Scheduled")).toBe("Scheduled");
    expect(statusLabel(null)).toBe("");
  });

  it("Paid is terminal in the sequence", () => {
    expect(STATUS_SEQUENCE[STATUS_SEQUENCE.length - 1]).toBe(STATUS_PAID);
    expect(STATUS_SEQUENCE).toHaveLength(5);
  });
});
