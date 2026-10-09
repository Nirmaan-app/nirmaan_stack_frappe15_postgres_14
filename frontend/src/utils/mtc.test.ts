import { describe, expect, it } from "vitest";

import type { MaterialTestCertificate } from "@/types/NirmaanStack/MaterialTestCertificate";
import {
  billableLines,
  certificateDateProblem,
  coverableLines,
  editableLines,
  isPoOpenForMTC,
  mtcFileName,
  mtcItemTag,
  mtcLineKey,
} from "./mtc";

const PO_ITEMS = [
  { item_id: "ITEM-A", make: "Tata", billing_status: "Billable", item_name: "MS Pipe 25mm" },
  { item_id: "ITEM-B", make: "Jindal", billing_status: "Billable", item_name: "GI Elbow" },
  { item_id: "ITEM-C", make: "", billing_status: "Non-Billable", item_name: "Freight" },
  { item_id: "ITEM-A", make: "Local", billing_status: "Billable", item_name: "MS Pipe 25mm" },
  { item_id: "ITEM-A", make: "Tata", billing_status: "Billable", item_name: "duplicate row" },
];

const mtc = (name: string, items: [string, string][]): MaterialTestCertificate => ({
  name,
  procurement_order: "PO-1",
  project: "P-1",
  attachment: "/x.pdf",
  owner: "u",
  creation: "2026-10-07",
  items: items.map(([item_id, make]) => ({ item_id, make })),
});

describe("isPoOpenForMTC", () => {
  it("is open for a Billable PO in any status except Merged, Cancelled, Inactive", () => {
    for (const status of ["PO Approved", "Partially Dispatched", "Dispatched", "Partially Delivered", "Delivered"]) {
      expect(isPoOpenForMTC("Billable", status)).toBe(true);
    }
    for (const status of ["Merged", "Cancelled", "Inactive"]) {
      expect(isPoOpenForMTC("Billable", status)).toBe(false);
    }
    expect(isPoOpenForMTC("Non-Billable", "Delivered")).toBe(false);
    expect(isPoOpenForMTC(undefined, "Delivered")).toBe(false);
    expect(isPoOpenForMTC("Billable", "")).toBe(false);
  });
});

describe("billableLines", () => {
  it("keeps billable lines once each, in PO order, item + make as identity", () => {
    const lines = billableLines(PO_ITEMS);
    expect(lines.map((l) => l.key)).toEqual([
      mtcLineKey("ITEM-A", "Tata"),
      mtcLineKey("ITEM-B", "Jindal"),
      mtcLineKey("ITEM-A", "Local"),
    ]);
    expect(lines[0].item_name).toBe("MS Pipe 25mm");
  });

  it("normalises blank makes", () => {
    expect(mtcLineKey("X", null)).toBe(mtcLineKey(" X ", "  "));
  });
});

describe("coverableLines", () => {
  it("drops lines already on another MTC of the PO", () => {
    const lines = coverableLines(PO_ITEMS, [mtc("MTC-1", [["ITEM-A", "Tata"]])]);
    expect(lines.map((l) => l.key)).toEqual([
      mtcLineKey("ITEM-B", "Jindal"),
      mtcLineKey("ITEM-A", "Local"),
    ]);
  });

  it("is empty once every billable line is covered", () => {
    const all = mtc("MTC-1", [
      ["ITEM-A", "Tata"],
      ["ITEM-B", "Jindal"],
      ["ITEM-A", "Local"],
    ]);
    expect(coverableLines(PO_ITEMS, [all])).toEqual([]);
  });
});

describe("editableLines", () => {
  it("offers the MTC's own items first, then free lines, never another MTC's", () => {
    const mine = mtc("MTC-1", [["ITEM-A", "Tata"], ["ITEM-Z", "Gone"]]);
    const other = mtc("MTC-2", [["ITEM-B", "Jindal"]]);
    const keys = editableLines(mine, PO_ITEMS, [mine, other]).map((l) => l.key);
    expect(keys).toEqual([
      mtcLineKey("ITEM-A", "Tata"),
      mtcLineKey("ITEM-Z", "Gone"),
      mtcLineKey("ITEM-A", "Local"),
    ]);
  });
});

describe("certificateDateProblem", () => {
  it("requires a date that is not after today", () => {
    expect(certificateDateProblem("2026-10-07", "2026-10-07")).toBeNull();
    expect(certificateDateProblem("2025-01-31", "2026-10-07")).toBeNull();
    expect(certificateDateProblem("2026-10-08", "2026-10-07")).toMatch(/future/);
    expect(certificateDateProblem("", "2026-10-07")).toMatch(/Enter/);
    expect(certificateDateProblem(null, "2026-10-07")).toMatch(/Enter/);
  });
});

describe("mtcFileName", () => {
  it("reads the name from a cloud URL's file_name, else the path, else a fallback", () => {
    expect(
      mtcFileName("/api/method/frappe_gcp_attachment.controller.generate_file?key=abc&file_name=MTC%20Pipes.pdf")
    ).toBe("MTC Pipes.pdf");
    expect(mtcFileName("/private/files/adhesive.pdf")).toBe("adhesive.pdf");
    expect(mtcFileName("")).toBe("Attached file");
    expect(mtcFileName(undefined)).toBe("Attached file");
  });
});

describe("mtcItemTag", () => {
  it("tags an item a revision removed, or made non-billable", () => {
    expect(mtcItemTag({ item_id: "ITEM-A", make: "Tata" }, PO_ITEMS)).toBeNull();
    expect(mtcItemTag({ item_id: "ITEM-Z", make: "Tata" }, PO_ITEMS)).toBe("gone");
    expect(mtcItemTag({ item_id: "ITEM-C", make: "" }, PO_ITEMS)).toBe("not-billable");
  });
});
