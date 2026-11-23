// @vitest-environment jsdom
import { createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DCMIRWiseMaterialTable, type DCMIRWiseMaterialTableHandle } from "./DCMIRWiseMaterialTable";
import type { DCMIRWiseDisplayItem } from "./ProjectMaterialUsageTab";

const exportToCsv = vi.fn();
vi.mock("@/utils/exportToCsv", () => ({ exportToCsv: (...args: unknown[]) => exportToCsv(...args) }));
vi.mock("@/components/ui/use-toast", () => ({ toast: vi.fn() }));
vi.mock("@/constants/siteURL", () => ({ default: "" }));

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const doc = (over: Partial<DCMIRWiseDisplayItem>): DCMIRWiseDisplayItem => ({
  documentName: "PDD-1",
  referenceNumber: "DC-1",
  type: "PO",
  poNumber: "PO/001/00085/26-27",
  vendorName: "Acme Traders",
  dcDate: "2026-10-19",
  creation: "2026-10-30 10:00:00",
  billingCategory: "Billable",
  totalReceivedQuantity: 5,
  totalQuantity: 5,
  itemCount: 1,
  isSignedByClient: false,
  isStub: false,
  items: [{ itemId: "ITEM-1", itemName: "Cable 4 sq mm", category: "Electrical", unit: "MTR", receivedQuantity: 5, quantity: 5, billingCategory: "Billable" }],
  ...over,
});

// A PO DC and an ITM DC (the GI Sheet case: 11 delivered on the ITM's DN, the DC keyed as 1116.8).
const ITEMS: DCMIRWiseDisplayItem[] = [
  doc({}),
  doc({
    documentName: "PDD-2026-02651",
    referenceNumber: "36",
    dcReference: "DC-36",
    type: "ITM",
    poNumber: "ITM-2026-00017",
    vendorName: "From Warehouse",
    totalReceivedQuantity: 11,
    totalQuantity: 1116.8,
    items: [{ itemId: "ITEM-001155", itemName: "GI Sheet - 24G", category: "Ducting", unit: "NOS", receivedQuantity: 11, quantity: 1116.8, billingCategory: "Billable" }],
  }),
];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  exportToCsv.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const render = (type: "dc" | "mir", ref = createRef<DCMIRWiseMaterialTableHandle>()) => {
  act(() => root.render(<DCMIRWiseMaterialTable ref={ref} type={type} items={ITEMS} projectId="PROJ-1" />));
  return ref;
};
const headerTexts = () => [...container.querySelectorAll("thead th")].map((th) => th.textContent?.trim() ?? "");
const rowOf = (text: string) => [...container.querySelectorAll("tbody tr")].find((tr) => tr.textContent?.includes(text));
const spanOf = (tr: Element) => [...tr.querySelectorAll("td")].reduce((n, td) => n + Number(td.getAttribute("colspan") || 1), 0);

describe.each(["dc", "mir"] as const)("DCMIRWiseMaterialTable (%s)", (type) => {
  it("has a Type column and a PO/ITM No. column, not PO Number", () => {
    render(type);
    const headers = headerTexts();
    expect(headers).toContain("Type");
    expect(headers).toContain("PO/ITM No.");
    expect(headers).not.toContain("PO Number");
    expect(headers.indexOf("Type") + 1).toBe(headers.indexOf("PO/ITM No."));
  });

  it("lists an ITM document beside the PO one, with its ITM badge, number and source", () => {
    render(type);
    const itmRow = rowOf("ITM-2026-00017");
    expect(itmRow).toBeTruthy();
    const cells = [...itmRow!.querySelectorAll("td")].map((td) => td.textContent?.trim());
    expect(cells).toContain("ITM");
    expect(cells).toContain("From Warehouse");
    expect(cells).toContain("11.00");
    const poCells = [...rowOf("PO/001/00085/26-27")!.querySelectorAll("td")].map((td) => td.textContent?.trim());
    expect(poCells).toContain("PO");
    expect(poCells).toContain("Acme Traders");
  });

  it("every row spans exactly the header's columns, an expanded item row included", () => {
    render(type);
    const columns = headerTexts().length;
    const itmRow = rowOf("ITM-2026-00017")!;
    expect(spanOf(itmRow)).toBe(columns);
    act(() => { (itmRow as HTMLElement).click(); });
    const itemRow = rowOf("GI Sheet - 24G")!;
    expect(itemRow).toBeTruthy();
    expect(spanOf(itemRow)).toBe(columns);
  });

  it("exports Type and PO/ITM No. on every row", () => {
    const ref = render(type);
    act(() => ref.current!.exportCsv());
    expect(exportToCsv).toHaveBeenCalledTimes(1);
    const [, rows, columns] = exportToCsv.mock.calls[0] as [string, Record<string, string>[], { header: string }[]];
    const headers = columns.map((c) => c.header);
    expect(headers).toContain("Type");
    expect(headers).toContain("PO/ITM No.");
    expect(headers).not.toContain("PO Number");
    expect(rows.find((r) => r["PO/ITM No."] === "ITM-2026-00017")).toMatchObject({ Type: "ITM", Vendor: "From Warehouse" });
    expect(rows.find((r) => r["PO/ITM No."] === "PO/001/00085/26-27")).toMatchObject({ Type: "PO", Vendor: "Acme Traders" });
  });
});
