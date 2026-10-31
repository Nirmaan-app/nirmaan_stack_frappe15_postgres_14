import { describe, expect, it } from "vitest";

import { holderAuditRecord, isLostDamagedReasonValid, latestLostDamaged } from "./assetLostDamaged";
import type { AssetHistoryRow } from "./assetHistory";

const HOLDER = "a@x";
const DECLARED = { asset_declaration_attachment: "/files/decl.pdf" };

function fulfilled(idx: number, forMonth: string, assignedTo = HOLDER, answers?: unknown): AssetHistoryRow {
  return {
    name: `h${idx}`, idx, event: "Audit Fulfilled", assigned_to: assignedTo, done_by: assignedTo,
    done_on: "2026-09-29 18:02:11.123456", reason: `for ${forMonth} · Kept in the store`, audit_answers: answers,
  };
}

describe("isLostDamagedReasonValid", () => {
  it("needs 10 characters after trimming, in any wording (owner, 2026-10-31)", () => {
    expect(isLostDamagedReasonValid("Screen cracked")).toBe(true);
    expect(isLostDamagedReasonValid("  123456789  ")).toBe(false);
    expect(isLostDamagedReasonValid("")).toBe(false);
    expect(isLostDamagedReasonValid(null)).toBe(false);
  });
});

describe("latestLostDamaged", () => {
  it("picks the newest Lost/Damaged row, after a Found/Repaired and a second marking", () => {
    const rows: AssetHistoryRow[] = [
      { name: "a", idx: 1, event: "Asset Lost/Damaged", reason: "first time" },
      { name: "b", idx: 2, event: "Asset Found/Repaired", reason: "back" },
      { name: "c", idx: 3, event: "Asset Lost/Damaged", reason: "second time" },
      { name: "d", idx: 4, event: "Assigned" },
    ];
    expect(latestLostDamaged(rows)?.name).toBe("c");
    expect(latestLostDamaged([])).toBeNull();
    expect(latestLostDamaged(undefined)).toBeNull();
  });
});

describe("holderAuditRecord", () => {
  it("names the last audit THIS holder sent, with its answers, and the open one", () => {
    const answers = { answers: [{ id: "working", q: "Is it working?", a: "No, it is not working", flag: 1, text: "Screen dead" }] };
    const history = [fulfilled(3, "09/2026", "someone@else"), fulfilled(5, "10/2026", HOLDER, answers), fulfilled(4, "08/2026")];
    const record = holderAuditRecord(HOLDER, { ...DECLARED, audit_status: "Pending", audit_month: "11/2026" }, history);
    expect(record.lastSent).toBe("Last audit sent: for October 2026, on 29-Sep-2026 06:02 PM.");
    expect(record.lastAnswers).toEqual(answers.answers);
    expect(record.openNow).toBe("November 2026 audit not sent yet. It ends with no result and won't count as missed.");
    expect(record.owes).toBe(true);
  });

  it("says when the holder never sent one, and when they are overdue", () => {
    const record = holderAuditRecord(
      HOLDER,
      { ...DECLARED, audit_status: "Pending", audit_month: "11/2026", audit_overdue_since: "09/2026" },
      [fulfilled(2, "08/2026", "someone@else")],
    );
    expect(record.lastSent).toBe("No audit sent yet for this asset.");
    expect(record.lastAnswers).toEqual([]);
    expect(record.openNow).toBe("Overdue since September 2026; November 2026 not sent. It ends with no result.");
  });

  it("is quiet when nothing is open, and explains an unsigned declaration", () => {
    expect(holderAuditRecord(HOLDER, { ...DECLARED, audit_status: "Fulfilled" }, [fulfilled(1, "10/2026")]))
      .toMatchObject({ openNow: "No audit open right now.", owes: false });
    expect(holderAuditRecord(HOLDER, { asset_declaration_attachment: null }, []).openNow)
      .toBe("Declaration not signed yet, so no audit was due.");
    expect(holderAuditRecord(HOLDER, null, null).openNow).toBe("No audit open right now.");
  });
});
