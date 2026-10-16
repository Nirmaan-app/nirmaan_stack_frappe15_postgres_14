import { describe, expect, it } from "vitest";

import {
  AUDIT_CONDITIONS,
  assetCardTone,
  auditCycleRanges,
  auditBadge,
  auditMonthLabel,
  auditsToSubmit,
  canSubmitAudit,
  countAuditsToSubmit,
  cycleMonth,
  isAuditOverdue,
  overdueMonths,
  parseFulfilledText,
  sentLate,
} from "./assetAudit";

describe("audit month", () => {
  it("is two digits slash year, like the server", () => {
    expect(auditMonthLabel(new Date(2026, 8, 30))).toBe("09/2026");
    expect(auditMonthLabel(new Date(2027, 0, 1))).toBe("01/2027");
  });
});

describe("the cycle", () => {
  it("is this month before the 28th and next month from it, like the server", () => {
    expect(auditMonthLabel(cycleMonth(new Date(2026, 9, 27)))).toBe("10/2026");
    expect(auditMonthLabel(cycleMonth(new Date(2026, 9, 28)))).toBe("11/2026");
    expect(auditMonthLabel(cycleMonth(new Date(2026, 11, 30)))).toBe("01/2027");
    expect(auditMonthLabel(cycleMonth(new Date(2026, 1, 28)))).toBe("03/2026");
  });

  it("marks an audit late only when sent after its month -- in the grace days", () => {
    expect(sentLate("10/2026", "2026-11-03 10:15:00")).toBe(true);
    expect(sentLate("10/2026", "2026-10-15 09:00:00")).toBe(false);
    expect(sentLate("11/2026", "2026-10-29 09:00:00")).toBe(false); // early, from the 28th: on time
    expect(sentLate("12/2026", "2027-01-02")).toBe(true);
    expect(sentLate(null, "2026-11-03")).toBe(false); // a row written before the month was recorded
    expect(sentLate("10/2026", null)).toBe(false);
  });
});

describe("the conditions", () => {
  it("are the server's four, best to worst", () => {
    expect([...AUDIT_CONDITIONS]).toEqual(["Good", "Fair", "Poor", "Damaged"]);
  });
});

describe("the audit badge", () => {
  it("is amber with the month it is for while nothing was missed -- the grace days too", () => {
    expect(auditBadge({ audit_status: "Pending", audit_month: "11/2026", last_audit_on: "2026-10-06" }, true, "Laptop")).toEqual({
      tone: "pending",
      text: "Audit pending · 11/2026",
      hint: "Audit for 11/2026 waiting to be sent · last audit 06-Oct-2026",
    });
    // last month's, still open on the 3rd: not red until the 7th records it Missed
    expect(auditBadge({ audit_status: "Pending", audit_month: "10/2026" }, true, "Laptop").tone).toBe("pending");
  });

  it("turns red once a month was recorded Missed, saying since when -- never how many", () => {
    expect(
      auditBadge(
        { audit_status: "Pending", audit_month: "11/2026", audit_overdue_since: "09/2026", last_audit_on: "2026-08-04" },
        true,
        "Laptop"
      )
    ).toEqual({
      tone: "overdue",
      text: "Audit overdue since 09/2026",
      hint: "Overdue: 09/2026, 10/2026 · audit for 11/2026 open · last audit 04-Aug-2026",
    });
    expect(auditBadge({ audit_status: "Pending", audit_month: "11/2026", audit_overdue_since: "10/2026" }, true, "Laptop").hint).toBe(
      "Overdue: 10/2026 · audit for 11/2026 open · no audit sent yet"
    );
    // a long run: the hover lists three months and counts the rest
    expect(auditBadge({ audit_status: "Pending", audit_month: "11/2026", audit_overdue_since: "04/2026" }, true, "Laptop").hint).toMatch(
      /^Overdue: 04\/2026, 05\/2026, 06\/2026, \+4 more · /
    );
  });

  it("keeps an open audit even when the category is switched off", () => {
    expect(auditBadge({ audit_status: "Pending", audit_month: "11/2026", last_audit_on: "2026-10-06" }, false, "Chair").tone).toBe("pending");
  });

  it("shows when the last audit was sent, and nothing overdue after it", () => {
    expect(auditBadge({ audit_status: "Fulfilled", last_audit_on: "2026-10-08" }, true, "Laptop")).toEqual({
      tone: "done",
      text: "Audit done 08-Oct-2026",
    });
    // a leftover month on a sent audit (the server clears it on send) never shows
    expect(auditBadge({ audit_status: "Fulfilled", last_audit_on: "2026-11-14", audit_overdue_since: "09/2026" }, true, "Laptop").tone).toBe(
      "done"
    );
  });

  it("says no audit yet, or that the category isn't audited", () => {
    expect(auditBadge({}, true, "Laptop")).toEqual({ tone: "none", text: "No audit yet" });
    expect(auditBadge({ audit_status: "" }, false, "Chair")).toEqual({ tone: "off", text: "Not audited: Chair" });
  });
});

describe("the profile card's tint", () => {
  const pending = auditBadge({ audit_status: "Pending", audit_month: "11/2026" }, true, "Laptop");
  const overdue = auditBadge({ audit_status: "Pending", audit_month: "11/2026", audit_overdue_since: "09/2026" }, true, "Laptop");
  const done = auditBadge({ audit_status: "Fulfilled", last_audit_on: "2026-10-08" }, true, "Laptop");

  it("is red while the audit is overdue, even with the declaration pending too", () => {
    expect(assetCardTone(false, overdue)).toBe("overdue");
    expect(assetCardTone(true, overdue)).toBe("overdue");
  });

  it("is yellow while the declaration or the audit is pending -- the grace days too", () => {
    expect(assetCardTone(false, pending)).toBe("pending");
    expect(assetCardTone(true, done)).toBe("pending");
    expect(assetCardTone(true, null)).toBe("pending");
    // last month's, still open on the 3rd: yellow, not red, until the 7th records it Missed
    expect(assetCardTone(false, auditBadge({ audit_status: "Pending", audit_month: "10/2026" }, true, "Laptop"))).toBe("pending");
  });

  it("is plain with the declaration on file and nothing pending", () => {
    expect(assetCardTone(false, done)).toBeNull();
    expect(assetCardTone(false, null)).toBeNull();
    expect(assetCardTone(false, auditBadge({}, true, "Laptop"))).toBeNull();
    expect(assetCardTone(false, auditBadge({}, false, "Chair"))).toBeNull();
  });
});

describe("the overdue months", () => {
  it("run from the first missed month up to the month before the open audit's", () => {
    expect(overdueMonths({ audit_month: "11/2026", audit_overdue_since: "09/2026" })).toEqual(["09/2026", "10/2026"]);
    expect(overdueMonths({ audit_month: "01/2027", audit_overdue_since: "11/2026" })).toEqual(["11/2026", "12/2026"]);
    expect(overdueMonths({ audit_month: "11/2026", audit_overdue_since: "10/2026" })).toEqual(["10/2026"]);
  });

  it("are just the first month when the open one can't be read, and none without one", () => {
    expect(overdueMonths({ audit_month: "", audit_overdue_since: "09/2026" })).toEqual(["09/2026"]);
    expect(overdueMonths({ audit_month: "11/2026", audit_overdue_since: "11/2026" })).toEqual(["11/2026"]);
    expect(overdueMonths({ audit_month: "11/2026" })).toEqual([]);
  });
});

describe("who submits", () => {
  const base = { viewerId: "a@x", assignedTo: "a@x", currentAssignee: "a@x", auditStatus: "Pending" };

  it("is the holder, with an audit open", () => {
    expect(canSubmitAudit(base)).toBe(true);
    expect(canSubmitAudit({ ...base, viewerId: "hr@x" })).toBe(false);
    expect(canSubmitAudit({ ...base, currentAssignee: "b@x" })).toBe(false); // a leftover row
    expect(canSubmitAudit({ ...base, auditStatus: "Fulfilled" })).toBe(false);
    expect(canSubmitAudit({ ...base, viewerId: undefined })).toBe(false);
  });

  it("counts only the held assets with an open audit", () => {
    const rows = [
      { asset: "A1", asset_assigned_to: "a@x", audit_status: "Pending" },
      { asset: "A2", asset_assigned_to: "a@x", audit_status: "Fulfilled" },
      { asset: "A3", asset_assigned_to: "a@x", audit_status: "Pending" }, // held by someone else now
      { asset: "A4", asset_assigned_to: "a@x", audit_status: null },
    ];
    expect(countAuditsToSubmit("a@x", rows, new Set(["A1", "A2", "A4"]))).toBe(1);
  });
});

describe("an overdue audit (the red sidebar icon)", () => {
  it("is an open audit with a month recorded Missed and nothing sent since", () => {
    expect(isAuditOverdue({ audit_status: "Pending", audit_overdue_since: "09/2026" })).toBe(true);
    expect(isAuditOverdue({ audit_status: "Pending", audit_overdue_since: null })).toBe(false);
    expect(isAuditOverdue({ audit_status: "Pending", audit_overdue_since: "" })).toBe(false);
    expect(isAuditOverdue({ audit_status: "Fulfilled", audit_overdue_since: "09/2026" })).toBe(false);
    expect(isAuditOverdue({ audit_status: null, audit_overdue_since: "09/2026" })).toBe(false);
  });

  it("agrees with the badge's tone on every row", () => {
    const rows = [
      { audit_status: "Pending", audit_month: "11/2026", audit_overdue_since: "09/2026" },
      { audit_status: "Pending", audit_month: "11/2026", last_audit_on: "2026-01-01" },
      { audit_status: "Pending", audit_month: "11/2026" },
      { audit_status: "Fulfilled", last_audit_on: "2026-01-01", audit_overdue_since: "09/2026" },
    ];
    for (const row of rows) {
      expect(isAuditOverdue(row)).toBe(auditBadge(row, true, "Laptop").tone === "overdue");
    }
  });

  it("is counted only among the audits the holder can send", () => {
    const rows = [
      { asset: "A1", asset_assigned_to: "a@x", audit_status: "Pending", audit_overdue_since: "09/2026" },
      { asset: "A2", asset_assigned_to: "a@x", audit_status: "Pending", audit_overdue_since: null },
      { asset: "A3", asset_assigned_to: "a@x", audit_status: "Pending", audit_overdue_since: "09/2026" }, // someone else holds it now
    ];
    const mine = auditsToSubmit("a@x", rows, new Set(["A1", "A2"]));
    expect(mine.map((row) => row.asset)).toEqual(["A1", "A2"]);
    expect(mine.filter((row) => isAuditOverdue(row)).map((row) => row.asset)).toEqual(["A1"]);
  });
});

describe("reading an Audit Fulfilled row", () => {
  it("reads the month and the remarks", () => {
    expect(parseFulfilledText("for 11/2026 · Kept in the site store · rack 2")).toEqual({
      forMonth: "11/2026",
      remarks: "Kept in the site store · rack 2",
    });
    expect(parseFulfilledText("for 10/2026")).toEqual({ forMonth: "10/2026", remarks: null });
    expect(parseFulfilledText(null)).toEqual({ forMonth: null, remarks: null });
  });

  it("skips the condition a row sent before 2026-10-15 starts with", () => {
    expect(parseFulfilledText("Damaged · was Fair · for 11/2026 · Screen cracked")).toEqual({ forMonth: "11/2026", remarks: "Screen cracked" });
    expect(parseFulfilledText("Good · for 10/2026")).toEqual({ forMonth: "10/2026", remarks: null });
    expect(parseFulfilledText("Fair · keys worn")).toEqual({ forMonth: null, remarks: "keys worn" });
    expect(parseFulfilledText("Poor · for the third time cracked").forMonth).toBeNull();
  });

});

describe("the month split shown when a category's audit is turned on", () => {
  it("is this month to the 27th, next month from the 28th, marking today", () => {
    expect(auditCycleRanges(new Date(2026, 9, 14))).toEqual([
      { days: "1–27 Oct", month: "10/2026", current: true },
      { days: "28–31 Oct", month: "11/2026", current: false },
    ]);
    expect(auditCycleRanges(new Date(2026, 9, 29)).map((range) => range.current)).toEqual([false, true]);
  });

  it("flips exactly on the 28th, like cycleMonth", () => {
    expect(auditCycleRanges(new Date(2026, 10, 27))[0].current).toBe(true);
    expect(auditCycleRanges(new Date(2026, 10, 28))[1]).toEqual({ days: "28–30 Nov", month: "12/2026", current: true });
  });

  it("rolls December into next year and handles February's length", () => {
    expect(auditCycleRanges(new Date(2026, 11, 30))[1]).toEqual({ days: "28–31 Dec", month: "01/2027", current: true });
    expect(auditCycleRanges(new Date(2027, 1, 10))[1].days).toBe("28 Feb");
    expect(auditCycleRanges(new Date(2028, 1, 10))[1].days).toBe("28–29 Feb");
  });
});
