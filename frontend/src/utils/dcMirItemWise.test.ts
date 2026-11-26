import { describe, expect, it } from "vitest";

import type { InternalTransferMemoItem } from "@/types/NirmaanStack/InternalTransferMemo";
import type { PurchaseOrderItem } from "@/types/NirmaanStack/ProcurementOrders";
import type { DCItem, PODeliveryDocuments } from "@/types/NirmaanStack/PODeliveryDocuments";

import { buildItemWiseRows, buildItmItemWiseRows, countByStatus } from "./dcMirItemWise";

const item = (
  item_id: string,
  category: string,
  quantity: number,
  received_quantity: number | undefined,
  billing_status: PurchaseOrderItem["billing_status"] = "Billable"
): PurchaseOrderItem => ({
  name: `row-${item_id}-${quantity}`,
  item_id,
  item_name: `Item ${item_id}`,
  unit: "Nos",
  category,
  quantity,
  received_quantity,
  quote: 0,
  status: "",
  tax: 18,
  billing_status,
});

const line = (item_id: string, category: string, quantity: number): DCItem => ({
  item_id,
  item_name: `Item ${item_id}`,
  unit: "Nos",
  category,
  quantity,
});

const doc = (
  name: string,
  type: PODeliveryDocuments["type"],
  items: DCItem[],
  extra: Partial<PODeliveryDocuments> = {}
): PODeliveryDocuments => ({
  name,
  creation: "2026-11-01 10:00:00",
  project: "PROJ-1",
  type,
  reference_number: name,
  is_signed_by_client: 0,
  is_stub: 0,
  items,
  ...extra,
});

// The example PO from the proposal page.
const ITEMS = [
  item("cement", "Cement", 100, 70),
  item("tmt", "Steel", 5, 5),
  item("conduit", "Electrical", 200, 200),
  item("sand", "Aggregates", 400, 400),
  item("wire", "Steel", 50, 0),
  item("cover", "Civil", 500, 300),
  item("unloading", "Additional Charges", 1, 1, "Non-Billable"),
];
const DOCS = [
  doc("DC-089", "Delivery Challan", [], { is_stub: 1 }),
  doc("DC-101", "Delivery Challan", [line("cement", "Cement", 40), line("tmt", "Steel", 2), line("conduit", "Electrical", 120)]),
  doc("MIR-07", "Material Inspection Report", [line("cement", "Cement", 70), line("tmt", "Steel", 2), line("conduit", "Electrical", 200)]),
  doc("DC-115", "Delivery Challan", [line("cement", "Cement", 30), line("conduit", "Electrical", 80), line("cover", "Civil", 350)]),
];

const rowFor = (id: string) => {
  const row = buildItemWiseRows(ITEMS, DOCS).rows.find((r) => r.itemId === id);
  if (!row) throw new Error(`no row for ${id}`);
  return row;
};

describe("buildItemWiseRows", () => {
  it("adds an item's quantities across two DCs and lists both", () => {
    const conduit = rowFor("conduit");
    expect(conduit.dcQty).toBe(200);
    expect(conduit.mirQty).toBe(200);
    expect(conduit.dcPending).toBe(0);
    expect(conduit.status).toBe("matched");
    expect(conduit.docs.map((d) => [d.referenceNumber, d.quantity])).toEqual([
      ["DC-101", 120],
      ["DC-115", 80],
      ["MIR-07", 200],
    ]);
  });

  it("flags a short DC on a fully received item", () => {
    const tmt = rowFor("tmt");
    expect([tmt.dcQty, tmt.dcPending, tmt.status]).toEqual([2, 3, "mismatch"]);
  });

  it("flags a received item with no DC", () => {
    const sand = rowFor("sand");
    expect([sand.dcQty, sand.dcPending, sand.status]).toEqual([0, 400, "no_dc_update"]);
    expect(sand.docs).toEqual([]);
  });

  it("marks an item with nothing received as Pending DN", () => {
    expect(rowFor("wire").status).toBe("pending_dn");
  });

  it("marks a short delivery that is fully challaned as Partially Delivered", () => {
    const cement = rowFor("cement");
    expect([cement.dcQty, cement.dcPending, cement.status]).toEqual([70, 0, "partially_delivered"]);
  });

  it("gives a negative DC Pending when the DCs cover more than was received", () => {
    const cover = rowFor("cover");
    expect([cover.dcQty, cover.dcPending, cover.status]).toEqual([350, -50, "matched"]);
  });

  it("marks a Non-Billable item Not Billable", () => {
    expect(rowFor("unloading").status).toBe("not_billable");
  });

  it("counts stub and empty documents in no row and returns them", () => {
    const empty = doc("DC-120", "Delivery Challan", []);
    const { rows, uncountedDocs } = buildItemWiseRows(ITEMS, [...DOCS, empty]);
    expect(uncountedDocs.map((d) => d.name)).toEqual(["DC-089", "DC-120"]);
    expect(rows.flatMap((r) => r.docs).some((d) => d.name === "DC-089" || d.name === "DC-120")).toBe(false);
  });

  it("merges a PO item listed twice and adds both lines of one DC", () => {
    const { rows } = buildItemWiseRows(
      [item("pipe", "Plumbing", 10, 6), item("pipe", "Plumbing", 5, 4)],
      [doc("DC-1", "Delivery Challan", [line("pipe", "Plumbing", 3), line("pipe", "Plumbing", 2)])]
    );
    expect(rows).toHaveLength(1);
    expect([rows[0].orderedQty, rows[0].receivedQty, rows[0].dcQty]).toEqual([15, 10, 5]);
    expect(rows[0].docs).toEqual([expect.objectContaining({ referenceNumber: "DC-1", quantity: 5 })]);
  });

  it("matches on category as well as item ID, and ignores DC lines for items not on the PO", () => {
    const { rows } = buildItemWiseRows(
      [item("x", "Cement", 10, 10)],
      [doc("DC-1", "Delivery Challan", [line("x", "Steel", 10), line("ghost", "Cement", 4)])]
    );
    expect(rows[0].dcQty).toBe(0);
    expect(rows[0].status).toBe("no_dc_update");
  });

  it("treats a missing received quantity as 0", () => {
    const { rows } = buildItemWiseRows([item("y", "Civil", 10, undefined)], []);
    expect([rows[0].receivedQty, rows[0].status]).toEqual([0, "pending_dn"]);
  });

  it("uses dc_date when set and the upload date otherwise", () => {
    const { rows } = buildItemWiseRows(
      [item("z", "Civil", 10, 10)],
      [
        doc("DC-A", "Delivery Challan", [line("z", "Civil", 4)], { dc_date: "2026-11-05" }),
        doc("DC-B", "Delivery Challan", [line("z", "Civil", 6)]),
      ]
    );
    expect(rows[0].docs.map((d) => d.date)).toEqual(["2026-11-05", "2026-11-01 10:00:00"]);
  });
});

describe("countByStatus", () => {
  it("counts each status once per row", () => {
    expect(countByStatus(buildItemWiseRows(ITEMS, DOCS).rows)).toEqual({
      partially_delivered: 1,
      mismatch: 1,
      matched: 2,
      no_dc_update: 1,
      pending_dn: 1,
      not_billable: 1,
    });
  });
});

const itmItem = (
  item_id: string,
  category: string,
  transfer_quantity: number,
  received_quantity: number | undefined
): InternalTransferMemoItem => ({
  item_id,
  item_name: `Item ${item_id}`,
  unit: "Nos",
  category,
  transfer_quantity,
  estimated_rate: 0,
  received_quantity,
});

describe("buildItmItemWiseRows", () => {
  // Transfer Qty 60 each — the worked cases shown to the owner.
  const ITM_ITEMS = [
    itmItem("full", "Shuttering", 60, 60),
    itmItem("short", "Shuttering", 60, 60),
    itmItem("nodc", "Shuttering", 60, 60),
    itmItem("partEq", "Shuttering", 60, 40),
    itmItem("partShort", "Shuttering", 60, 40),
    itmItem("none", "Shuttering", 60, 0),
    itmItem("dcOnly", "Shuttering", 60, undefined),
  ];
  const ITM_DOCS = [
    doc("DC-ITM-1", "Delivery Challan", [
      line("full", "Shuttering", 60),
      line("short", "Shuttering", 25),
      line("partEq", "Shuttering", 40),
      line("partShort", "Shuttering", 25),
      line("dcOnly", "Shuttering", 20),
    ]),
    doc("MIR-ITM-1", "Material Inspection Report", [line("full", "Shuttering", 60)]),
  ];
  const statusOf = (id: string) => buildItmItemWiseRows(ITM_ITEMS, ITM_DOCS).rows.find((r) => r.itemId === id)?.status;

  it("uses the ITM rule, not the PO rule", () => {
    expect(statusOf("full")).toBe("matched");
    expect(statusOf("short")).toBe("mismatch");
    expect(statusOf("nodc")).toBe("no_dc_update");
    expect(statusOf("partEq")).toBe("matched"); // PO rule: partially_delivered
    expect(statusOf("partShort")).toBe("mismatch"); // PO rule: matched
    expect(statusOf("none")).toBe("no_activity"); // ITM rule says matched; owner: show "–" (PO rule: pending_dn)
    expect(statusOf("dcOnly")).toBe("pending_dn");
  });

  it("uses Transfer Qty as the ordered quantity, counts MIRs, and never marks an item Not Billable", () => {
    const { rows } = buildItmItemWiseRows(ITM_ITEMS, ITM_DOCS);
    const full = rows.find((r) => r.itemId === "full");
    expect([full?.orderedQty, full?.receivedQty, full?.dcQty, full?.mirQty]).toEqual([60, 60, 60, 60]);
    expect(rows.every((r) => r.billable && r.status !== "not_billable")).toBe(true);
  });

  it("falls back to the item ID when an ITM item has no name", () => {
    const { rows } = buildItmItemWiseRows([{ ...itmItem("noname", "Civil", 5, 5), item_name: undefined }], []);
    expect(rows[0].itemName).toBe("noname");
  });
});

describe("ITM no_activity", () => {
  it("shows '–' only when nothing is received AND no DC is filed (an MIR alone does not count)", () => {
    const { rows } = buildItmItemWiseRows(
      [itmItem("a", "Civil", 10, 0), itmItem("b", "Civil", 10, 0)],
      [
        doc("MIR-1", "Material Inspection Report", [line("a", "Civil", 5)]),
        doc("DC-1", "Delivery Challan", [line("b", "Civil", 5)]),
      ]
    );
    expect(rows.map((r) => r.status)).toEqual(["no_activity", "pending_dn"]);
  });

  it("never appears on a PO (the PO rule says Pending DN)", () => {
    const { rows } = buildItemWiseRows([item("p", "Civil", 10, 0)], []);
    expect(rows[0].status).toBe("pending_dn");
  });
});
