// @vitest-environment jsdom
/** The pieces every Estimates view draws a line's materials with: the cell, the expanded table and the type badge. */
import type { ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { customItem, estimate, normalItem } from "../estimatesTestData";
import { ExpandedMaterials, formatQty, ItemTypeBadge, MaterialsCell } from "./MaterialsParts";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(() => act(() => root.unmount()));

const render = (el: ReactElement) => act(() => root.render(el));
const buttons = () => [...container.querySelectorAll("button")];
const button = (text: string) => buttons().find((b) => b.textContent?.trim() === text);

describe("formatQty", () => {
  it("shows a dash for nothing or zero, and up to three decimals in Indian grouping", () => {
    expect([formatQty(null), formatQty(undefined), formatQty(0)]).toEqual(["—", "—", "—"]);
    expect(formatQty(2.5)).toBe("2.5");
    expect(formatQty(1234567.891)).toBe("12,34,567.891");
  });
});

describe("ItemTypeBadge", () => {
  it("says Normal, or just Custom with the reason on hover", () => {
    render(<span><ItemTypeBadge type="Normal" /><ItemTypeBadge type="Custom" /></span>);
    const [normal, custom] = [...container.querySelectorAll("span > span")];
    expect(normal.textContent).toBe("Normal");
    expect(custom.textContent?.trim()).toBe("Custom");
    expect(custom.getAttribute("title")).toBe("Not in Items list");
  });
});

describe("MaterialsCell", () => {
  it("offers + Add on a line with no materials to an editor, and a dash to a viewer", () => {
    const onEdit = vi.fn();
    render(<MaterialsCell canEdit expanded={false} onToggle={vi.fn()} onEdit={onEdit} />);
    act(() => button("+ Add")!.click());
    expect(onEdit).toHaveBeenCalledTimes(1);

    render(<MaterialsCell canEdit={false} expanded={false} onToggle={vi.fn()} onEdit={vi.fn()} />);
    expect(buttons()).toHaveLength(0);
    expect(container.textContent).toBe("—");
  });

  it("counts the items, opens and closes them, and shows Edit to an editor only", () => {
    const onToggle = vi.fn();
    const entry = estimate("L1", [normalItem(), customItem()]);
    render(<MaterialsCell entry={entry} canEdit expanded={false} onToggle={onToggle} onEdit={vi.fn()} />);
    expect(button("▸ 2 items")?.getAttribute("aria-expanded")).toBe("false");
    act(() => button("▸ 2 items")!.click());
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(button("Edit")).toBeTruthy();

    render(<MaterialsCell entry={estimate("L1", [normalItem()])} canEdit={false} expanded onToggle={onToggle} onEdit={vi.fn()} />);
    expect(buttons().map((b) => b.textContent?.trim())).toEqual(["▾ 1 item"]);
  });
});

describe("ExpandedMaterials", () => {
  const entry = estimate("L1", [normalItem({ make: "Made-up make", quantity: 2.5 }), customItem({ category: null })]);

  it("lists each material with dashes for what is empty, and the line's BOQ qty", () => {
    render(<ExpandedMaterials entry={entry} lineQty={12} lineUnit="Sqm" canEdit={false} onEdit={vi.fn()} />);
    const cells = [...container.querySelectorAll("tbody tr")].map((tr) => [...tr.querySelectorAll("td")].map((td) => td.textContent?.trim()));
    expect(cells).toEqual([
      ["Normal", "Made-up panel", "Made-up make", "Made-up Boards", "sqm", "2.5"],
      ["Custom", "Made-up clip", "—", "—", "NOS", "2"],
    ]);
    expect(container.textContent).toContain("BOQ qty 12 Sqm · 2 materials");
    expect(buttons()).toHaveLength(0);
  });

  it("shows Edit to an editor, and Open in Line Item View only where it is offered", () => {
    const onEdit = vi.fn();
    const onOpen = vi.fn();
    render(<ExpandedMaterials entry={entry} lineQty={12} lineUnit="Sqm" canEdit onEdit={onEdit} onOpenInLineView={onOpen} />);
    act(() => button("Edit material estimate")!.click());
    act(() => button("Open in Line Item View")!.click());
    expect([onEdit.mock.calls.length, onOpen.mock.calls.length]).toEqual([1, 1]);

    render(<ExpandedMaterials entry={entry} lineQty={12} lineUnit="Sqm" canEdit onEdit={onEdit} />);
    expect(button("Open in Line Item View")).toBeUndefined();
  });
});
