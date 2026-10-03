import { describe, expect, it } from "vitest";
import {
  UNASSIGNED,
  assigneeOptions,
  columnTone,
  dcEntryPlan,
  deadlineFilters,
  dcFreshness,
  etaTag,
  inr,
  inrShort,
  managerNames,
  parseAmount,
  poAmount,
  poInputOf,
  progressNote,
  projectStatusTone,
  setupSummary,
  statusTone,
  trackersAssignedTo,
} from "./billingFormat";

describe("parseAmount", () => {
  it("reads lakh / crore / k shorthands and Indian grouping", () => {
    expect(parseAmount("2.5L")).toBe(250000);
    expect(parseAmount("2.5 lakh")).toBe(250000);
    expect(parseAmount("1.2cr")).toBe(12000000);
    expect(parseAmount("75k")).toBe(75000);
    expect(parseAmount("2,50,000")).toBe(250000);
    expect(parseAmount("₹ 1,000")).toBe(1000);
  });

  it("keeps zero and negative corrections", () => {
    expect(parseAmount("0")).toBe(0);
    expect(parseAmount("-1.5L")).toBe(-150000);
  });

  it("refuses text it cannot read", () => {
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("abc")).toBeNull();
    expect(parseAmount("2.5x")).toBeNull();
  });
});

describe("package setup", () => {
  it("reads a typed PO value: blank is 0, junk and negatives are refused", () => {
    expect(poAmount("")).toBe(0);
    expect(poAmount("  ")).toBe(0);
    expect(poAmount("92L")).toBe(9200000);
    expect(poAmount("92,00,000")).toBe(9200000);
    expect(poAmount("abc")).toBeNull();
    expect(poAmount("-5L")).toBeNull();
  });

  it("prefills a saved PO value in Indian grouping that reads back to the same number", () => {
    expect(poInputOf(9200000)).toBe("92,00,000");
    expect(poAmount(poInputOf(9200000))).toBe(9200000);
    expect(poInputOf(0)).toBe("");
    expect(poInputOf(null)).toBe("");
    // Paise are kept as typed, so reopening and saving changes nothing.
    expect(poInputOf(1250.5)).toBe("1250.5");
  });

  it("names managers in pick order, falling back to the user id", () => {
    expect(managerNames([{ user: "a@x", full_name: "Abhishek Kumar" }, { user: "m@x", full_name: "" }])).toEqual([
      "Abhishek Kumar",
      "m@x",
    ]);
    expect(managerNames([])).toEqual([]);
    expect(managerNames(null)).toEqual([]);
  });

  it("totals the PO values and lists what each ticked package still lacks", () => {
    const summary = setupSummary({
      Electrical: { managers: ["a@x", "m@x"], po: "92L" },
      HVAC: { managers: ["a@x"], po: "36,00,000" },
      FA: { managers: [], po: "" },
      PA: { managers: ["a@x"], po: "4x" },
    });
    expect(summary.count).toBe(4);
    expect(summary.total).toBe(12800000);
    expect(summary.noManager).toEqual(["FA"]);
    expect(summary.noPoValue).toEqual(["FA"]);
    expect(summary.unreadable).toEqual(["PA"]);
  });

  it("is empty before anything is ticked", () => {
    expect(setupSummary({})).toEqual({ count: 0, total: 0, noManager: [], noPoValue: [], unreadable: [] });
  });
});

describe("dcEntryPlan", () => {
  const ZERO = "0 can't be saved. Enter the value delivered today.";

  it("no longer points at the hidden No delivery today button", () => {
    expect(dcEntryPlan("add", 0, 500000).problem).not.toMatch(/No delivery today/);
  });

  it("refuses a typed 0 in Add today's, including values that round to 0", () => {
    expect(dcEntryPlan("add", parseAmount("0"), 500000)).toEqual({ amount: 0, newTotal: 500000, problem: ZERO });
    expect(dcEntryPlan("add", parseAmount("0L"), 500000).problem).toBe(ZERO);
    expect(dcEntryPlan("add", parseAmount("0.4"), 500000).problem).toBe(ZERO);
    expect(dcEntryPlan("add", parseAmount("-0"), 0).problem).toBe(ZERO);
  });

  it("refuses a corrected total that changes nothing", () => {
    expect(dcEntryPlan("correct", parseAmount("5L"), 500000).problem).toBe("Same as the current total. Nothing to save.");
    expect(dcEntryPlan("correct", parseAmount("0"), 0).problem).toBe("Same as the current total. Nothing to save.");
  });

  it("still saves a real correction down to zero, as a minus entry", () => {
    expect(dcEntryPlan("correct", parseAmount("0"), 500000)).toEqual({ amount: -500000, newTotal: 0, problem: "" });
  });

  it("saves ordinary entries and keeps the below-zero guard", () => {
    expect(dcEntryPlan("add", parseAmount("2.5L"), 500000)).toEqual({ amount: 250000, newTotal: 750000, problem: "" });
    expect(dcEntryPlan("add", parseAmount("-1L"), 500000)).toEqual({ amount: -100000, newTotal: 400000, problem: "" });
    expect(dcEntryPlan("correct", parseAmount("4L"), 500000)).toEqual({ amount: -100000, newTotal: 400000, problem: "" });
    expect(dcEntryPlan("add", parseAmount("-6L"), 500000).problem).toBe("Total would go below zero");
  });

  it("stays quiet while the box is empty or unreadable", () => {
    expect(dcEntryPlan("add", parseAmount(""), 500000)).toEqual({ amount: null, newTotal: null, problem: "" });
    expect(dcEntryPlan("correct", parseAmount("abc"), 500000)).toEqual({ amount: null, newTotal: null, problem: "" });
  });
});

describe("money formatting", () => {
  it("groups rupees the Indian way", () => {
    expect(inr(8663892)).toBe("₹86,63,892");
    expect(inr(999)).toBe("₹999");
    expect(inr(-150000)).toBe("-₹1,50,000");
    expect(inr(null)).toBe("—");
  });

  it("shortens to lakh and crore", () => {
    expect(inrShort(12400000)).toBe("₹1.24 Cr");
    expect(inrShort(1850000)).toBe("₹18.5 L");
    expect(inrShort(5000)).toBe("₹5,000");
  });
});

describe("dates", () => {
  const today = new Date("2026-10-03T10:00:00");

  it("tags ETAs relative to today", () => {
    expect(etaTag("2026-10-01", today)).toEqual({ label: "2d overdue", tone: "critical" });
    expect(etaTag("2026-10-03", today)?.label).toBe("Today");
    expect(etaTag("2026-10-04", today)?.label).toBe("Tomorrow");
    expect(etaTag("2026-10-08", today)?.label).toBe("In 5d");
    expect(etaTag("2026-10-20", today)).toBeNull();
    expect(etaTag(null, today)).toBeNull();
  });

  it("describes Supply DC freshness", () => {
    expect(dcFreshness("2026-10-03", today).isToday).toBe(true);
    expect(dcFreshness("2026-10-02", today).label).toBe("Updated yesterday");
    expect(dcFreshness("2026-09-29", today).label).toBe("4 days ago");
    expect(dcFreshness(null, today).label).toBe("Never updated");
  });
});

describe("statusTone", () => {
  it("colours hold red, revision orange, approved green, NA grey", () => {
    expect(statusTone("Client Hold")).toBe("critical");
    expect(statusTone("Revision Pending")).toBe("serious");
    expect(statusTone("Invoice Sent")).toBe("good");
    expect(statusTone("Certification Pending")).toBe("warning");
    expect(statusTone("NA")).toBe("neutral");
  });
});

describe("progressNote", () => {
  it("says what is left between billed and approved", () => {
    expect(progressNote(0, 0)).toBe("Nothing billed yet");
    expect(progressNote(640000, 0)).toBe("None approved yet");
    expect(progressNote(2760000, 2760000)).toBe("All billed value approved");
    expect(progressNote(2767000, 2760000)).toBe("₹7,000 awaiting approval");
  });
});

describe("projectStatusTone", () => {
  it("colours the project status chip", () => {
    expect(projectStatusTone("WIP")).toBe("warning");
    expect(projectStatusTone("Handover")).toBe("good");
    expect(projectStatusTone("CEO Hold")).toBe("critical");
    expect(projectStatusTone("Created")).toBe("neutral");
    expect(projectStatusTone(null)).toBe("neutral");
  });
});

describe("deadlineFilters", () => {
  const today = new Date("2026-10-03T10:00:00");
  it("keeps pending bills only for every deadline choice", () => {
    for (const choice of ["overdue", "week", "none"]) {
      const f = deadlineFilters(choice, today);
      expect(f[0][0]).toBe("status");
      expect(f[0][2]).toContain("Client Hold");
      expect(f[0][2]).not.toContain("Client Approved");
    }
  });
  it("builds the date condition", () => {
    expect(deadlineFilters("overdue", today)[1]).toEqual(["eta_date", "<", "2026-10-03"]);
    expect(deadlineFilters("week", today)[1]).toEqual(["eta_date", "between", ["2026-10-03", "2026-10-10"]]);
    expect(deadlineFilters("none", today)[1]).toEqual(["eta_date", "is", "not set"]);
    expect(deadlineFilters("all", today)).toEqual([]);
  });
});

describe("assignees", () => {
  const trackers = [
    { name: "T-ELEC", billing_managers: [{ user: "monish@x", full_name: "Monish" }, { user: "jigar@x", full_name: "Jigar" }] },
    { name: "T-HVAC", billing_managers: [{ user: "ameer@x", full_name: "Ameer" }] },
    { name: "T-ELV", billing_managers: [] },
  ];

  it("lists each person once, by name, then Unassigned when a package has nobody", () => {
    expect(assigneeOptions(trackers)).toEqual([
      { value: "ameer@x", label: "Ameer" },
      { value: "jigar@x", label: "Jigar" },
      { value: "monish@x", label: "Monish" },
      { value: UNASSIGNED, label: "Unassigned" },
    ]);
  });

  it("leaves Unassigned out when every package has a manager", () => {
    expect(assigneeOptions(trackers.slice(0, 2)).map((o) => o.value)).not.toContain(UNASSIGNED);
  });

  it("finds a person's packages, including shared ones", () => {
    expect(trackersAssignedTo(trackers, ["jigar@x"])).toEqual(["T-ELEC"]);
    expect(trackersAssignedTo(trackers, ["jigar@x", "ameer@x"])).toEqual(["T-ELEC", "T-HVAC"]);
  });

  it("maps Unassigned to the packages with no manager", () => {
    expect(trackersAssignedTo(trackers, [UNASSIGNED])).toEqual(["T-ELV"]);
  });

  it("returns nothing for nobody", () => {
    expect(trackersAssignedTo(trackers, [])).toEqual([]);
  });
});

describe("columnTone", () => {
  it("takes the most urgent status tone in the column", () => {
    expect(columnTone(["Client Hold", "Revision Pending"])).toBe("critical");
    expect(columnTone(["Prepared", "Submission Pending"])).toBe("warning");
    expect(columnTone(["Internally Approved", "Submitted", "Certification Pending"])).toBe("warning");
  });

  it("matches the single status badge for one-status columns", () => {
    expect(columnTone(["Not Started"])).toBe(statusTone("Not Started"));
    expect(columnTone(["Client Approved"])).toBe("good");
    expect(columnTone(["Payment Received", "Partial Payment Received"])).toBe("good");
  });
});
