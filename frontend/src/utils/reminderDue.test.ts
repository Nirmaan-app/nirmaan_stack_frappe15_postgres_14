import { describe, expect, it } from "vitest";

import { dueChip, roleChipClass, shortRoleProfile } from "./reminderDue";

// A local date, built the same way the helper reads the backend's strings.
const TODAY = new Date(2026, 9, 30); // 30-Oct-2026

describe("dueChip", () => {
  it("is null without a date", () => {
    expect(dueChip(undefined, undefined, TODAY)).toBeNull();
    expect(dueChip("", "2026-11-04", TODAY)).toBeNull();
  });

  it("labels today, the future and the past", () => {
    expect(dueChip("2026-10-30", null, TODAY)?.label).toBe("today");
    expect(dueChip("2026-11-07", null, TODAY)?.label).toBe("in 8d");
    expect(dueChip("2026-10-28", null, TODAY)?.label).toBe("2d ago");
  });

  it("is soon at 7 days or less, month up to 31, later beyond", () => {
    expect(dueChip("2026-11-06", null, TODAY)?.tone).toBe("soon"); // 7d
    expect(dueChip("2026-11-07", null, TODAY)?.tone).toBe("month"); // 8d
    expect(dueChip("2026-11-30", null, TODAY)?.tone).toBe("month"); // 31d
    expect(dueChip("2026-12-01", null, TODAY)?.tone).toBe("later"); // 32d
  });

  it("is soon once the Reminds On date has arrived, however far the due date is", () => {
    // notify_before_days = 40: reminds on 29-Oct for a 08-Dec due date
    expect(dueChip("2026-12-08", "2026-10-29", TODAY)?.tone).toBe("soon");
    expect(dueChip("2026-12-08", "2026-10-30", TODAY)?.tone).toBe("soon");
    expect(dueChip("2026-12-08", "2026-10-31", TODAY)?.tone).toBe("later");
  });

  it("is past once the due date has gone by", () => {
    expect(dueChip("2026-10-29", "2026-10-26", TODAY)).toEqual({ tone: "past", days: -1, label: "1d ago" });
  });

  it("counts calendar days, whatever the time of day", () => {
    const lateEvening = new Date(2026, 9, 30, 23, 59);
    expect(dueChip("2026-10-31", null, lateEvening)?.label).toBe("in 1d");
  });

  it("matches the real reminders on 30-Oct-2026", () => {
    expect(dueChip("2026-11-07", "2026-11-04", TODAY)).toEqual({ tone: "month", days: 8, label: "in 8d" });
    expect(dueChip("2027-01-31", "2027-01-28", TODAY)).toEqual({ tone: "later", days: 93, label: "in 93d" });
  });
});

describe("shortRoleProfile", () => {
  it("drops the Nirmaan prefix and Profile suffix", () => {
    expect(shortRoleProfile("Nirmaan Accountant Lead Profile")).toBe("Accountant Lead");
    expect(shortRoleProfile("Nirmaan Admin Profile")).toBe("Admin");
  });

  it("leaves other names alone", () => {
    expect(shortRoleProfile("Custom Role")).toBe("Custom Role");
  });
});

describe("roleChipClass", () => {
  const common = ["Nirmaan Admin Profile", "Nirmaan Accountant Profile", "Nirmaan Accountant Lead Profile"];

  it("gives the same role the same colour, by full or short name", () => {
    expect(roleChipClass("Nirmaan HR Executive Profile")).toBe(roleChipClass("HR Executive"));
    expect(roleChipClass("Nirmaan Admin Profile")).toBe(roleChipClass("Admin"));
  });

  it("never lets the three common roles share a colour", () => {
    expect(new Set(common.map(roleChipClass)).size).toBe(3);
  });

  it("keeps every other role off the three reserved colours", () => {
    const reserved = new Set(common.map(roleChipClass));
    for (const r of ["Material Procurement Executive", "Design Lead", "Billing Executive", "HR Executive", "PMO Executive", "Project Lead"]) {
      expect(reserved.has(roleChipClass(r))).toBe(false);
    }
  });
});
