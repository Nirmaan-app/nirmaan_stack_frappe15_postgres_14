import { describe, expect, it } from "vitest";

import {
  allowedTransferDirections,
  buildTransferPayload,
  effectiveDirection,
  parseTransferDirection,
  pickedTotals,
  projectStockRows,
  projectsWithStock,
  stockRowKey,
  warehouseStockRows,
  type TransferDraft,
} from "./itmTransfer";

const src = (
  source_project: string,
  make: string | null,
  available_quantity: number,
  source_project_name = `Name ${source_project}`
) => ({ source_project, source_project_name, make, available_quantity, estimated_rate: 100 });

const PICKER = [
  {
    item_id: "ITEM-A",
    item_name: "MS Pipe 25mm",
    unit: "Nos",
    category: "Pipes",
    sources: [src("P-1", "Tata", 10), src("P-1", "Jindal", 4), src("P-2", "Tata", 7)],
  },
  {
    item_id: "ITEM-B",
    item_name: "GI Elbow",
    unit: "Nos",
    category: "Fittings",
    sources: [src("P-2", null, 3), src("P-3", null, 0, "Zeta")],
  },
];

describe("parseTransferDirection", () => {
  it("accepts the three directions and nothing else", () => {
    expect(parseTransferDirection("warehouse-to-project")).toBe("warehouse-to-project");
    expect(parseTransferDirection("project-to-warehouse")).toBe("project-to-warehouse");
    expect(parseTransferDirection("project-to-project")).toBe("project-to-project");
    expect(parseTransferDirection("warehouse-to-warehouse")).toBeNull();
    expect(parseTransferDirection("")).toBeNull();
    expect(parseTransferDirection(null)).toBeNull();
    expect(parseTransferDirection(undefined)).toBeNull();
  });
});

describe("allowedTransferDirections", () => {
  it("gives creator roles and the Administrator user all three", () => {
    expect(allowedTransferDirections("Nirmaan Admin Profile")).toHaveLength(3);
    expect(allowedTransferDirections("Nirmaan PMO Executive Profile")).toHaveLength(3);
    expect(allowedTransferDirections("Nirmaan Procurement Executive Profile")).toHaveLength(3);
    expect(allowedTransferDirections("", "Administrator")).toHaveLength(3);
  });

  it("gives Project Managers and Leads Project -> Warehouse only", () => {
    for (const role of ["Nirmaan Project Manager Profile", "Nirmaan Project Lead Profile"]) {
      expect(allowedTransferDirections(role)).toEqual(["project-to-warehouse"]);
    }
  });

  it("gives other roles nothing, including while the role is still loading", () => {
    expect(allowedTransferDirections("Nirmaan Accountant Profile")).toEqual([]);
    expect(allowedTransferDirections("Loading")).toEqual([]);
  });
});

describe("effectiveDirection", () => {
  const pm = allowedTransferDirections("Nirmaan Project Manager Profile");
  const pl = allowedTransferDirections("Nirmaan Project Lead Profile");
  const admin = allowedTransferDirections("Nirmaan Admin Profile");

  it("lands a PM or PL on Project -> Warehouse, even from the old Request from Warehouse link", () => {
    for (const dirs of [pm, pl]) {
      expect(effectiveDirection(null, dirs)).toBe("project-to-warehouse");
      expect(effectiveDirection("warehouse-to-project", dirs)).toBe("project-to-warehouse");
      expect(effectiveDirection("project-to-project", dirs)).toBe("project-to-warehouse");
    }
  });

  it("keeps an allowed choice and leaves a multi-direction role unchosen otherwise", () => {
    expect(effectiveDirection("warehouse-to-project", admin)).toBe("warehouse-to-project");
    expect(effectiveDirection(null, admin)).toBeNull();
  });

  it("preselects a list's only direction, whatever was asked for", () => {
    expect(effectiveDirection(null, ["warehouse-to-project"])).toBe("warehouse-to-project");
    expect(effectiveDirection("project-to-project", ["warehouse-to-project"])).toBe("warehouse-to-project");
  });

  it("gives nothing to a role with no directions", () => {
    expect(effectiveDirection("warehouse-to-project", [])).toBeNull();
  });
});

describe("projectsWithStock", () => {
  it("lists each project with available stock once, sorted by name, skipping empty ones", () => {
    expect(projectsWithStock(PICKER)).toEqual([
      { value: "P-1", label: "Name P-1" },
      { value: "P-2", label: "Name P-2" },
    ]);
  });

  it("keeps only the given projects when scoped, even if others have stock", () => {
    expect(projectsWithStock(PICKER, new Set(["P-2", "P-3", "P-9"]))).toEqual([
      { value: "P-2", label: "Name P-2" },
    ]);
    expect(projectsWithStock(PICKER, new Set())).toEqual([]);
  });
});

describe("projectStockRows", () => {
  it("returns only the chosen project's stock, one row per make", () => {
    const rows = projectStockRows(PICKER, "P-1");
    expect(rows.map((r) => r.key)).toEqual([stockRowKey("ITEM-A", "Tata"), stockRowKey("ITEM-A", "Jindal")]);
    expect(rows.every((r) => r.item_id === "ITEM-A")).toBe(true);
  });

  it("never leaks another project's quantity into the chosen project's row", () => {
    const tata = projectStockRows(PICKER, "P-2").find((r) => r.key === stockRowKey("ITEM-A", "Tata"));
    expect(tata?.available_quantity).toBe(7);
  });

  it("drops buckets with nothing available", () => {
    expect(projectStockRows(PICKER, "P-3")).toEqual([]);
  });
});

describe("warehouseStockRows", () => {
  it("keeps available rows and normalises an empty make to null", () => {
    const rows = warehouseStockRows([
      { item_id: "ITEM-A", item_name: "MS Pipe", unit: "Nos", category: "Pipes", make: "", available_quantity: 5, estimated_rate: 1 },
      { item_id: "ITEM-B", item_name: "GI Elbow", unit: "Nos", category: "Fittings", available_quantity: 0, estimated_rate: 1 },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ key: "ITEM-A|", make: null, available_quantity: 5 });
  });
});

describe("pickedTotals", () => {
  const rows = projectStockRows(PICKER, "P-1"); // Tata 10 @100, Jindal 4 @100

  it("sums quantity x rate over the ticked rows", () => {
    expect(
      pickedTotals(rows, { [stockRowKey("ITEM-A", "Tata")]: 2, [stockRowKey("ITEM-A", "Jindal")]: 1.5 })
    ).toEqual({ items: 2, value: 350 });
  });

  it("counts a ticked row with no quantity yet, but adds no value for it", () => {
    expect(pickedTotals(rows, { [stockRowKey("ITEM-A", "Tata")]: 0 })).toEqual({ items: 1, value: 0 });
  });

  it("adds nothing for a pick whose row is gone", () => {
    expect(pickedTotals(rows, { [stockRowKey("ITEM-B", null)]: 3 })).toEqual({ items: 1, value: 0 });
  });

  it("is zero with nothing ticked", () => {
    expect(pickedTotals(rows, {})).toEqual({ items: 0, value: 0 });
  });
});

describe("buildTransferPayload", () => {
  const p1Rows = projectStockRows(PICKER, "P-1");
  const tataKey = stockRowKey("ITEM-A", "Tata");
  const draft = (over: Partial<TransferDraft>): TransferDraft => ({
    direction: "project-to-project",
    sourceProject: "P-1",
    targetProject: "P-9",
    picks: { [tataKey]: 2 },
    ...over,
  });
  const reason = (d: TransferDraft, rows = p1Rows) => {
    const r = buildTransferPayload(d, rows);
    return r.ok ? null : r.reason;
  };

  it("refuses each missing step in order", () => {
    expect(reason(draft({ direction: null }))).toBe("Choose a transfer type");
    expect(reason(draft({ sourceProject: null }))).toBe("Choose the source project");
    expect(reason(draft({ targetProject: null }))).toBe("Choose the destination project");
    expect(reason(draft({ picks: {} }))).toBe("Select at least one item");
  });

  it("refuses the same project on both sides", () => {
    expect(reason(draft({ targetProject: "P-1" }))).toBe("Source and destination cannot be the same project");
  });

  it("refuses zero, negative, NaN and over-available quantities", () => {
    expect(reason(draft({ picks: { [tataKey]: 0 } }))).toBe("Enter a quantity for MS Pipe 25mm");
    expect(reason(draft({ picks: { [tataKey]: -1 } }))).toBe("Enter a quantity for MS Pipe 25mm");
    expect(reason(draft({ picks: { [tataKey]: Number.NaN } }))).toBe("Enter a quantity for MS Pipe 25mm");
    expect(reason(draft({ picks: { [tataKey]: 10.5 } }))).toBe("MS Pipe 25mm: only 10 available");
  });

  it("allows exactly the available quantity", () => {
    expect(buildTransferPayload(draft({ picks: { [tataKey]: 10 } }), p1Rows).ok).toBe(true);
  });

  it("refuses a pick whose row is gone, e.g. another project's row after the source changed", () => {
    const p2Only = stockRowKey("ITEM-B", null);
    expect(reason(draft({ picks: { [p2Only]: 1 } }))).toMatch(/no longer available/);
  });

  it("builds a project -> project payload", () => {
    const r = buildTransferPayload(draft({}), p1Rows);
    expect(r).toEqual({
      ok: true,
      payload: {
        target_type: "Project",
        target_project: "P-9",
        selections: [
          { item_id: "ITEM-A", make: "Tata", source_type: "Project", source_project: "P-1", transfer_quantity: 2 },
        ],
      },
    });
  });

  it("sends the warehouse as a target type with no project, ignoring a stray target", () => {
    const r = buildTransferPayload(draft({ direction: "project-to-warehouse", targetProject: "P-1" }), p1Rows);
    expect(r.ok && r.payload).toMatchObject({ target_type: "Warehouse", target_project: null });
  });

  it("sends the warehouse as a source type with an empty source project, ignoring a stray source", () => {
    const whRows = warehouseStockRows([
      { item_id: "ITEM-A", item_name: "MS Pipe", unit: "Nos", category: "Pipes", make: "Tata", available_quantity: 5, estimated_rate: 1 },
    ]);
    const r = buildTransferPayload(
      draft({ direction: "warehouse-to-project", sourceProject: "P-1", targetProject: "P-1" }),
      whRows
    );
    expect(r.ok && r.payload.selections[0]).toMatchObject({ source_type: "Warehouse", source_project: "" });
    expect(r.ok && r.payload.target_project).toBe("P-1");
  });
});
