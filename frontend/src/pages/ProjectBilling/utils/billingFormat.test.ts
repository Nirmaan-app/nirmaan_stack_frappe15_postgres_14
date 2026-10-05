import { describe, expect, it } from "vitest";
import {
  ALL_STATUSES,
  UNASSIGNED,
  amountProblem,
  assigneeOptions,
  billDocMode,
  billMissing,
  billRequirements,
  billStatusOptions,
  clashingPackage,
  cleanPackageName,
  columnTone,
  dcEntryPlan,
  deadlineFilters,
  dcFreshness,
  etaTag,
  fileNameOf,
  inr,
  inrShort,
  managerNames,
  matchesBillStatus,
  parsePlainAmount,
  poAmount,
  poInputOf,
  progressNote,
  projectDeadline,
  projectStatusTone,
  setupSummary,
  skipsSubmitted,
  sortProjectsByDeadline,
  statusTone,
  trackersAssignedTo,
} from "./billingFormat";

describe("package setup", () => {
  it("reads a typed PO value as a plain amount: blank is 0, shorthand, junk and negatives are refused", () => {
    expect(poAmount("")).toBe(0);
    expect(poAmount("  ")).toBe(0);
    expect(poAmount("9200000")).toBe(9200000);
    expect(poAmount("92,00,000")).toBe(9200000);
    expect(poAmount("92L")).toBeNull();
    expect(poAmount("1.2cr")).toBeNull();
    expect(poAmount("abc")).toBeNull();
    expect(poAmount("-500000")).toBeNull();
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
      Electrical: { managers: ["a@x", "m@x"], po: "9200000" },
      HVAC: { managers: ["a@x"], po: "36,00,000" },
      FA: { managers: [], po: "" },
      PA: { managers: ["a@x"], po: "4L" },
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
  const ZERO = `0 can't be saved. If nothing was delivered, use "No delivery today".`;

  it("points a typed 0 at the No delivery today button, the one way to log a zero day", () => {
    expect(dcEntryPlan("add", 0, 500000)).toEqual({ amount: 0, newTotal: 500000, problem: ZERO });
    expect(dcEntryPlan("add", parsePlainAmount("-0"), 0).problem).toBe(ZERO);
  });

  it("asks for more than 0 in Add today's; lowering goes through Correct total", () => {
    expect(dcEntryPlan("add", -100000, 500000).problem).toBe("Enter an amount greater than 0. To lower the total, use Correct total.");
  });

  it("asks for a corrected total greater than 0", () => {
    expect(dcEntryPlan("correct", 0, 500000).problem).toBe("Enter a total greater than 0.");
    expect(dcEntryPlan("correct", -5, 500000).problem).toBe("Enter a total greater than 0.");
  });

  it("refuses a corrected total that changes nothing", () => {
    expect(dcEntryPlan("correct", 500000, 500000).problem).toBe("Same as the current total. Nothing to save.");
  });

  it("saves ordinary entries and corrections down, as a minus entry", () => {
    expect(dcEntryPlan("add", 250000, 500000)).toEqual({ amount: 250000, newTotal: 750000, problem: "" });
    expect(dcEntryPlan("add", 0.5, 0)).toEqual({ amount: 0.5, newTotal: 0.5, problem: "" });
    expect(dcEntryPlan("correct", 400000, 500000)).toEqual({ amount: -100000, newTotal: 400000, problem: "" });
  });

  it("stays quiet while the box is empty", () => {
    expect(dcEntryPlan("add", parsePlainAmount(""), 500000)).toEqual({ amount: null, newTotal: null, problem: "" });
  });
});

describe("amountProblem (bill value, payment received)", () => {
  it("empty is fine: the field is optional", () => {
    expect(amountProblem("")).toBe("");
    expect(amountProblem("   ")).toBe("");
  });

  it("a filled-in amount must be a plain number greater than 0", () => {
    expect(amountProblem("250000")).toBe("");
    expect(amountProblem("0.5")).toBe("");
    expect(amountProblem("0")).toBe("Enter an amount greater than 0");
    expect(amountProblem("-100")).toBe("Enter an amount greater than 0");
    expect(amountProblem("2.5L")).toBe("Numbers only, e.g. 250000");
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

describe("bill document", () => {
  it("opens an existing bill on what it already has, Link when it has nothing", () => {
    expect(billDocMode({ bill_attachment: "/private/files/bill.pdf" })).toBe("file");
    expect(billDocMode({ bill_attachment: null })).toBe("link");
    expect(billDocMode(null)).toBe("link");
  });

  it("names an attachment from its file_name, else its path", () => {
    expect(
      fileNameOf(
        "/api/method/frappe_gcp_attachment.controller.generate_file?key=attachments/2026/10/03/Project Billing/AB12_Bill.pdf&file_name=Bill%20Oct.pdf",
      ),
    ).toBe("Bill Oct.pdf");
    expect(fileNameOf("/api/method/x.generate_file?key=attachments/2026/10/03/AB12_Bill.pdf")).toBe("AB12_Bill.pdf");
    expect(fileNameOf("/private/files/RA%201%20bill.pdf")).toBe("RA 1 bill.pdf");
    expect(fileNameOf(null)).toBe("");
  });
});

describe("billing package names", () => {
  it("trims and collapses spaces like the server", () => {
    expect(cleanPackageName("  Fire   Alarm ")).toBe("Fire Alarm");
    expect(cleanPackageName("   ")).toBe("");
    expect(cleanPackageName(null)).toBe("");
  });

  it("finds a clash ignoring case and spacing", () => {
    const existing = ["Electrical", "HVAC", "Access Control"];
    expect(clashingPackage("electrical", existing)).toBe("Electrical");
    expect(clashingPackage(" access   control ", existing)).toBe("Access Control");
    expect(clashingPackage("Solar PV", existing)).toBeNull();
    expect(clashingPackage("   ", existing)).toBeNull();
  });
});

describe("project wise: billing-status filter and deadline sort", () => {
  const pkg = (eta?: string | null) => ({ next_bill: eta === undefined ? null : { eta_date: eta } });
  const row = (project: string, status: string | null, ...etas: (string | null | undefined)[]) => ({
    project,
    project_name: project,
    status,
    packages: etas.map(pkg),
  });

  it("a project's deadline is the earliest next-bill ETA among its packages", () => {
    expect(projectDeadline([pkg("2026-11-20"), pkg("2026-10-08"), pkg(undefined), pkg(null)])).toBe("2026-10-08");
    expect(projectDeadline([pkg(undefined), pkg(null)])).toBeNull();
    expect(projectDeadline([])).toBeNull();
  });

  it("billing-status options: the bill statuses present, once each, in the standard order", () => {
    const projects = [
      { bill_statuses: ["Submitted", "Not Started"] },
      { bill_statuses: ["NA", "Certification Pending", "Submitted"] },
      { bill_statuses: [] },
    ];
    expect(billStatusOptions(projects)).toEqual(["Not Started", "Submitted", "Certification Pending", "NA"]);
    expect(billStatusOptions([])).toEqual([]);
    expect(billStatusOptions([{ bill_statuses: ["Zeta Odd", "Prepared"] }])).toEqual(["Prepared", "Zeta Odd"]);
  });

  it("a project matches when any of its bills is in the picked status; no bills match nothing", () => {
    const p = { bill_statuses: ["Prepared", "Invoice Sent"] };
    expect(matchesBillStatus(p, "Invoice Sent")).toBe(true);
    expect(matchesBillStatus(p, "Client Approved")).toBe(false);
    expect(matchesBillStatus({ bill_statuses: [] }, "Not Started")).toBe(false);
    expect(matchesBillStatus({ bill_statuses: [] }, ALL_STATUSES)).toBe(true);
    expect(ALL_STATUSES).toBe("All statuses");
  });

  const rows = [
    row("Delta", "WIP", "2026-12-01"),
    row("Alpha", "WIP", undefined),
    row("Charlie", "WIP", "2026-10-10", "2026-11-01"),
    row("Bravo", "WIP", null),
    row("Echo", "WIP", "2026-10-10"),
  ];
  const names = (list: { project: string }[]) => list.map((r) => r.project);

  it("ascending: earliest deadline first, ties A to Z, no deadline last", () => {
    expect(names(sortProjectsByDeadline(rows, "asc"))).toEqual(["Charlie", "Echo", "Delta", "Alpha", "Bravo"]);
  });

  it("descending: latest deadline first, ties still A to Z, no deadline still last", () => {
    expect(names(sortProjectsByDeadline(rows, "desc"))).toEqual(["Delta", "Charlie", "Echo", "Alpha", "Bravo"]);
  });

  it("does not reorder the list it was given", () => {
    const copy = [...rows];
    sortProjectsByDeadline(rows, "asc");
    expect(rows).toEqual(copy);
  });
});

describe("supply DC: plain amounts and the PO value cap", () => {
  it("takes plain rupee amounts only, no L / cr shorthand", () => {
    expect(parsePlainAmount("250000")).toBe(250000);
    expect(parsePlainAmount(" 2,50,000 ")).toBe(250000);
    expect(parsePlainAmount("₹1500.5")).toBe(1500.5);
    expect(parsePlainAmount("-2000")).toBe(-2000);
    expect(parsePlainAmount("2.5L")).toBeNull();
    expect(parsePlainAmount("1.2cr")).toBeNull();
    expect(parsePlainAmount("12k")).toBeNull();
    expect(parsePlainAmount("1.234")).toBeNull();
    expect(parsePlainAmount("")).toBeNull();
    expect(parsePlainAmount(null)).toBeNull();
  });

  it("refuses a total above the PO value, allows up to it", () => {
    expect(dcEntryPlan("add", 40000, 60000, 100000).problem).toBe("");
    expect(dcEntryPlan("add", 40001, 60000, 100000).problem).toMatch(/More than the PO value/);
    expect(dcEntryPlan("correct", 100001, 60000, 100000).problem).toMatch(/More than the PO value/);
  });

  it("no PO value set means no cap", () => {
    expect(dcEntryPlan("add", 5000000, 0, 0).problem).toBe("");
    expect(dcEntryPlan("add", 5000000, 0).problem).toBe("");
  });

  it("a package already over its PO can still be corrected down", () => {
    expect(dcEntryPlan("correct", 150000, 200000, 100000).problem).toBe("");
    expect(dcEntryPlan("add", 1, 200000, 100000).problem).toMatch(/More than the PO value/);
  });
});

describe("required bill fields (mirrors rules.missing_bill_fields)", () => {
  const bill = (over: Partial<Parameters<typeof billMissing>[0]> = {}) => ({
    status: "Not Started",
    bill_type: "Supply 1",
    bill_value: "100",
    eta_date: "2026-11-01",
    hasDocument: false,
    payment_received: "",
    ...over,
  });

  it("a complete pending bill can be saved", () => {
    expect(billMissing(bill())).toEqual([]);
  });

  it("bill value must be greater than 0", () => {
    for (const bill_value of ["", "0", "-5", "2.5L"]) {
      expect(billMissing(bill({ bill_value }))).toEqual(["Bill value (greater than 0)"]);
    }
  });

  it("ETA only while pending; the document from Submitted on", () => {
    expect(billMissing(bill({ eta_date: "" }))).toEqual(["ETA date"]);
    expect(billMissing(bill({ status: "Client Approved", eta_date: "", hasDocument: true }))).toEqual([]);
    expect(billMissing(bill({ status: "Internally Approved" }))).toEqual([]);
    expect(billMissing(bill({ status: "Submitted" }))).toEqual(["Bill document (a link or an attachment)"]);
  });

  it("partial payment needs the amount received", () => {
    const partial = bill({ status: "Partial Payment Received", eta_date: "", hasDocument: true });
    expect(billMissing(partial)).toEqual(["Payment received (greater than 0)"]);
    expect(billMissing({ ...partial, payment_received: "500" })).toEqual([]);
    expect(billMissing(bill({ status: "Payment Received", eta_date: "", hasDocument: true }))).toEqual([]);
  });

  it("an NA bill needs nothing, by status or by bill type", () => {
    expect(billMissing(bill({ status: "NA", bill_value: "", eta_date: "" }))).toEqual([]);
    expect(billMissing(bill({ bill_type: "NA", bill_value: "", eta_date: "" }))).toEqual([]);
    expect(billRequirements("NA", "Supply 1")).toEqual({ billValue: false, eta: false, document: false, payment: false });
  });

  it("lists everything missing in the server's order", () => {
    expect(billMissing(bill({ status: "Submitted", bill_value: "", eta_date: "" }))).toEqual([
      "Bill value (greater than 0)",
      "ETA date",
      "Bill document (a link or an attachment)",
    ]);
  });
});

describe("skipsSubmitted (only Submitted stamps the first submission date)", () => {
  it("warns when a bill jumps past Submitted without a first submission date", () => {
    expect(skipsSubmitted("Client Approved", "Prepared", false)).toBe(true);
    expect(skipsSubmitted("Certification Pending", "Internally Approved", false)).toBe(true);
    expect(skipsSubmitted("Invoice Sent", undefined, false)).toBe(true); // a new bill saved straight in
  });

  it("stays quiet on Submitted itself, before it, or once the date is set", () => {
    expect(skipsSubmitted("Submitted", "Prepared", false)).toBe(false);
    expect(skipsSubmitted("Prepared", "Not Started", false)).toBe(false);
    expect(skipsSubmitted("Revision Pending", "Submitted", false)).toBe(false);
    expect(skipsSubmitted("Client Approved", "Submitted", true)).toBe(false);
  });

  it("stays quiet when the status is not being changed", () => {
    expect(skipsSubmitted("Client Approved", "Client Approved", false)).toBe(false);
  });
});
