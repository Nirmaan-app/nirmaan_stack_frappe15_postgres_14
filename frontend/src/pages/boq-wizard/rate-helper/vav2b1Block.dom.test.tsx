// @vitest-environment jsdom
//
// VAV-2b1 T2 / B5 / B6 (owner 2026-11-20 18:42 "this is ok" = screen 7; 18:44 "yes to all ... the usual revert icons"): the REAL
// `RateHelperPanel`, calculator variant, on a SCRATCH VAV config carrying the next rate file's keys -- the three add buttons, a share
// added by the user with the number of VAVs EMPTY (nothing priced), 80 typed -> the counts and the sum, the source tags, the revert icon
// on each edited box, "Or type the amount" -> "Amount typed by you", remove; and the "Review before using" block (B6) drawn directly
// above the row total. jsdom does no layout: what is pinned is the DOM the user reads and the edits the clicks make.
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, describe, expect, it } from "vitest";

import { RateHelperPanel } from "./RateHelperPanel";
import { makePricingSheetHelper } from "./pricingSheetHelper";
import { readdirSync } from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { calculatorCtx } from "../../pricing/PricingCalculator";
import { readJsonFixture } from "../../pricing/calculatorPanelParity.harness";
import type { RateCategoryConfig, RateMasterItem } from "../../pricing/rate-master/rateMasterTypes";
import { withV79Items, withV79Keys } from "./vav2b1Keys.harness";
import { ReviewBlock } from "./SharedItemBlock";

// the latest HVAC asset by version number (a latest-asset reader by file prefix: rate_master_hvac_all_v); its VAV config already carries
// the v78 keys; the next file's keys are applied to a scratch copy
type Asset = { discipline: string; items: RateMasterItem[]; category_configs: RateCategoryConfig[] };
const DATA_DIR = path.resolve(__dirname, "../../../../../nirmaan_stack/services/boq_rate_master/data");
const latestHvac = readdirSync(DATA_DIR).filter((f) => /^rate_master_hvac_all_v\d+\.json$/.test(f))
  .sort((a, b) => Number(a.match(/v(\d+)/)![1]) - Number(b.match(/v(\d+)/)![1])).pop()!;
const HVAC = readJsonFixture<Asset>(pathToFileURL(path.join(DATA_DIR, latestHvac)));
const VAV = "hvac_vav_box";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
class StubResizeObserver { observe() { /* no layout */ } unobserve() { /* no layout */ } disconnect() { /* no layout */ } }
if (!(globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver) {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = StubResizeObserver;
}
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => { /* no layout */ };

let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(() => { act(() => root?.unmount()); host?.remove(); root = null; host = null; });

function mountCalculator(): HTMLElement {
  const m = new Map<string, RateCategoryConfig>(HVAC.category_configs.map((c) => [c.category_id, c]));
  m.set(VAV, withV79Keys(m.get(VAV)!));
  const items = withV79Items(HVAC.items.map((i) => ({ ...i, discipline: "HVAC" } as RateMasterItem)));
  const helper = makePricingSheetHelper({ configsByCategory: m, items, extractionByRow: new Map() });
  const ctx = calculatorCtx("HVAC", VAV);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(<RateHelperPanel variant="calculator" excelRow={ctx.excelRow} col="calculator" kind="supply_rate" ctx={ctx} helpers={[helper]} calculatorBlocks={[]} fieldColumns={1} blockColumns={1} />));
  return host;
}
const q = (el: HTMLElement, id: string) => el.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const click = (el: Element | null) => { if (!el) throw new Error("no element"); act(() => { (el as HTMLElement).click(); }); };
function type(input: HTMLInputElement | null, value: string) {
  if (!input) throw new Error("no input");
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => { set.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
}
const fieldInput = (el: HTMLElement, field: string) => q(el, `share-field-${field}`)?.querySelector("input") as HTMLInputElement | null;

describe("B5 the shared-item block in the Calculator (screen 7)", () => {
  it("POSITIVE three add buttons; added -> the block, tag 'added by you', VAVs EMPTY, the reason; type 80 -> 32 / 3 and the sum; revert; amount; remove", () => {
    const el = mountCalculator();
    const adds = q(el, "share-add-buttons")!;
    // PIN 18 (ANSWER 26 / 28; screen 7, owner 18:42): BEFORE ["Add DDC panel share", "Add BACnet controller share", "Add DP sensor share"] (the config order)
    expect([...adds.querySelectorAll("button")].map((b) => b.textContent?.trim())).toEqual(["Add BACnet controller share", "Add DP sensor share", "Add DDC panel share"]);
    click(q(el, "share-add-bacnet"));
    const blk = () => q(el, "share-block-bacnet")!;
    expect(blk().textContent).toContain("Shared item - BACnet controller share");
    expect(q(blk(), "share-tag")!.textContent).toBe("added by you");
    expect(fieldInput(blk(), "vavs")!.value).toBe("");
    expect(q(blk(), "share-reason")!.textContent).toBe("Type the number of VAVs on the sheet to price this share.");
    expect(q(blk(), "share-field-vavs")!.querySelector('[data-testid="share-field-revert"]')).toBeNull();
    type(fieldInput(blk(), "vavs"), "80");
    expect(fieldInput(blk(), "controllers_per")!.value).toBe("32");
    expect(fieldInput(blk(), "controllers_count")!.value).toBe("3");
    expect(q(blk(), "share-sum")!.textContent).toContain("3 x (46,200 + 3,200) = 1,48,200 / 80 VAVs = 1,853 per box");
    expect(q(blk(), "share-figures")!.textContent).toBe("Supply 1,733 · Install 120 per box");
    expect(q(blk(), "share-field-vavs")!.textContent).toContain("typed by you");
    // a count changed by hand: kept, marked, and its revert icon
    type(fieldInput(blk(), "controllers_count"), "5");
    expect(q(blk(), "share-field-controllers_count")!.textContent).toContain("changed by you");
    click(q(blk(), "share-field-controllers_count")!.querySelector('[data-testid="share-field-revert"]'));
    expect(fieldInput(blk(), "controllers_count")!.value).toBe("3");
    // "Or type the amount" -> "Amount typed by you", then its revert
    type(q(blk(), "share-amount")!.querySelector('input[aria-label="Supply"]') as HTMLInputElement, "2000");
    expect(q(blk(), "share-sum")!.textContent).toContain("Amount typed by you");
    click(q(blk(), "share-amount-revert"));
    expect(q(blk(), "share-sum")!.textContent).toContain("1,853 per box");
    // remove -> the block goes, its add button comes back
    click(q(blk(), "share-remove"));
    expect(q(el, "share-block-bacnet")).toBeNull();
    expect(q(el, "share-add-bacnet")).not.toBeNull();
  });
  it("POSITIVE the DDC panel share replaces the other two: adding it takes the BACnet block and both add buttons away", () => {
    const el = mountCalculator();
    click(q(el, "share-add-bacnet"));
    click(q(el, "share-add-ddc"));
    expect(q(el, "share-block-bacnet")).toBeNull();
    expect(q(el, "share-block-ddc")!.textContent).toContain("Replaces the BACnet and DP sensor shares on this row.");
    expect(q(el, "share-add-buttons")).toBeNull();
  });
});

describe("B6 the 'Review before using' block", () => {
  it("POSITIVE a bordered amber block with an icon, the heading in bold and the sentence (role alert)", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root!.render(<ReviewBlock heading="Review before using" note="This rate combines the box with 3 extras (Rs 1 of Rs 2). Review each item before using." />));
    const b = q(host, "item-review-block")!;
    expect(b.getAttribute("role")).toBe("alert");
    expect(b.className).toMatch(/border-amber-500/);
    expect(b.querySelector("svg")).not.toBeNull();
    expect(b.querySelector(".font-bold")!.textContent).toBe("Review before using");
    expect(q(b, "item-combination-warning")!.textContent).toMatch(/combines the box with 3 extras/);
  });
});
