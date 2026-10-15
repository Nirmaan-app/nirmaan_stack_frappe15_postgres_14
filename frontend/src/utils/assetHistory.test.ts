import { describe, expect, it } from "vitest";

import { AssetHistoryRow, describeHistory, formatHistoryTime } from "./assetHistory";

const names: Record<string, string> = { "hr@x": "HR Desk", "bhavani@x": "Bhavani", "sharookh@x": "Sharookh" };
const nameOf = (id?: string | null) => (id ? names[id] ?? id : "—");

const rows: AssetHistoryRow[] = [
  { name: "r1", idx: 1, event: "Asset Added", done_by: "hr@x", done_on: "2026-08-18 12:02:00.000000", to_department: "Procurement" },
  { name: "r2", idx: 2, event: "Assigned", assigned_to: "sharookh@x", done_by: "hr@x", done_on: "2026-08-21 19:08:43.491291" },
  { name: "r3", idx: 3, event: "Unassigned", assigned_to: "sharookh@x", done_by: "hr@x", done_on: "2026-10-10 09:12:00" },
  {
    name: "r4", idx: 4, event: "Assigned", assigned_to: "bhavani@x", done_by: "hr@x", done_on: "2026-10-11 16:20:00",
    from_department: "Procurement", to_department: "Projects", reason: "Moved to site team",
  },
  { name: "r5", idx: 5, event: "Declaration Signed", assigned_to: "bhavani@x", done_by: "bhavani@x", done_on: "2026-10-12 11:05:00", declaration: "/api/method/x?key=a.pdf" },
];

describe("describeHistory", () => {
  const entries = describeHistory(rows, nameOf);

  it("lists newest first", () => {
    expect(entries.map((e) => e.key)).toEqual(["r5", "r4", "r3", "r2", "r1"]);
  });

  it("names people and says what happened", () => {
    expect(entries[0].title).toBe("Declaration signed by Bhavani");
    expect(entries[1].title).toBe("Assigned to Bhavani");
    expect(entries[2].title).toBe("Unassigned from Sharookh");
    expect(entries[4].title).toBe("Asset added");
    expect(entries[1].by).toBe("HR Desk");
  });

  it("shows a department move with its reason", () => {
    expect(entries[1].department).toBe("Procurement → Projects");
    expect(entries[1].reason).toBe("Moved to site team");
    expect(entries[4].department).toBe("Department: Procurement");
  });

  it("links a declaration, and flags one whose file is gone", () => {
    expect(entries[0].declarationUrl).toBe("/api/method/x?key=a.pdf");
    const [gone] = describeHistory([{ name: "g", idx: 1, event: "Declaration Uploaded", done_by: "hr@x" }], nameOf);
    expect(gone.declarationMissing).toBe(true);
  });

  it("falls back to the user id for unknown people", () => {
    const [row] = describeHistory([{ name: "a", idx: 1, event: "Asset Added", done_by: "Administrator" }], nameOf);
    expect(row.by).toBe("Administrator");
  });
});

describe("formatHistoryTime", () => {
  it("formats Frappe datetimes, microseconds included", () => {
    expect(formatHistoryTime("2026-10-12 16:05:15.510342")).toBe("12-Oct-2026 04:05 PM");
  });

  it("returns null for nothing or junk", () => {
    expect(formatHistoryTime(null)).toBeNull();
    expect(formatHistoryTime("not a date")).toBeNull();
  });
});

describe("return events", () => {
  const nameOf = (id?: string | null) => (id === "bittu@x" ? "Bittu" : id ?? "");

  it("reads a return and a rejection in plain words, under the Returns filter", () => {
    const [rejected, requested] = describeHistory(
      [
        { name: "a", idx: 1, event: "Return Requested", assigned_to: "bittu@x", done_by: "bittu@x", done_on: "2026-10-14 10:12:00" },
        { name: "b", idx: 2, event: "Return Rejected", assigned_to: "bittu@x", done_by: "hr@x", done_on: "2026-10-14 16:00:00", reason: "Return of 14-10-2026" },
      ],
      nameOf
    );
    expect(requested.title).toBe("Returned by Bittu, waiting for approval");
    expect(rejected.title).toBe("Return rejected, Bittu keeps it");
    expect([requested.tone, rejected.tone]).toEqual(["return", "return"]);
  });
});

describe("monthly audit rows", () => {
  const [fulfilled, created] = describeHistory(
    [
      { name: "a1", idx: 1, event: "Audit Requested", assigned_to: "bhavani@x", done_by: "Administrator", done_on: "2026-10-01 06:00:00", reason: "10/2026" },
      {
        name: "a2", idx: 2, event: "Audit Fulfilled", assigned_to: "bhavani@x", done_by: "bhavani@x", done_on: "2026-10-08 11:20:00",
        reason: "Damaged · was Fair · Screen cracked", declaration: "/api/method/x?key=photo.jpg",
      },
    ],
    nameOf
  );

  it("names a missed month, by System", () => {
    const [missed] = describeHistory(
      [{ name: "m1", idx: 3, event: "Audit Missed", assigned_to: "bhavani@x", done_by: "Administrator", done_on: "2026-11-01 06:00:00", reason: "10/2026" }],
      nameOf
    );
    expect(missed.title).toBe("Audit Missed by Bhavani");
    expect(missed.auditKind).toBe("missed");
    expect(missed.by).toBe("System");
    expect(missed.reason).toBeNull(); // the stored text is shown as a short line instead
    expect(missed.auditLine).toBe("October 2026 was not sent");
    expect(missed.tone).toBe("audit");
  });

  it("reads 'by System' for the cron and names the holder", () => {
    expect(created.title).toBe("Audit Requested for Bhavani");
    expect(created.auditKind).toBe("requested");
    expect(created.by).toBe("System");
    expect(created.tone).toBe("audit");
    expect(created.photoUrl).toBeNull();
    expect(created.auditLine).toBe("For October 2026 · opened by the monthly run");
  });

  it("shows the condition and links the photo, not a declaration", () => {
    expect(fulfilled.title).toBe("Audit Fulfilled by Bhavani"); // no condition any more
    expect(fulfilled.auditKind).toBe("fulfilled");
    // An old row ("Damaged · was Fair · Screen cracked"): the condition is skipped, the remarks stay.
    expect(fulfilled.reason).toBe("Screen cracked");
    expect(fulfilled.auditLine).toBeNull();
    expect(fulfilled.photoUrl).toBe("/api/method/x?key=photo.jpg");
    expect(fulfilled.declarationUrl).toBeNull();
    expect(fulfilled.declarationMissing).toBe(false);
  });
});
