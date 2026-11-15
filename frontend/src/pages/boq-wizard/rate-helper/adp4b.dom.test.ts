// @vitest-environment jsdom
/**
 * ADP-4b (owner D8, 2026-10-21 14:41 / 14:49; PA1-R) -- AC1, RENDERED: every category's Derivation tab is the rules listing.
 * The tab shows the rules list only, or ONE line saying where a row is priced (Pricing Inputs: what they hold); no
 * attribute boxes, no figures, no step cards, no inline editor; the extraction Rules card stays where the config carries
 * rules and its empty state is dropped. On HVAC v50 and Electrical v66 as loaded. The rest of ADP-4b is `adp4b.test.ts`
 * (node); this file is a `.dom` file because a DOM test is opted in by its FILENAME (vitest.config.ts).
 */
import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import type { RateCategoryConfig, RateMasterItem } from "@/pages/pricing/rate-master/rateMasterTypes";
import { readJsonFixture } from "@/pages/pricing/calculatorPanelParity.harness";
import { itemListRuleOrder } from "@/pages/pricing/rate-master/itemListRuleOrder";
import {
  CALCULATOR_TAB_LABEL, PRICING_INPUTS_DERIVATION_LINE, RateMasterDerivation, calculatorPageLabel, derivationNoticeLine,
} from "@/pages/pricing/rate-master/RateMasterDerivation";
import { RATE_MASTER_DISCIPLINES, rateMasterPageEntry } from "@/pages/pricing/rate-master/rateMasterRegistry";
import { CALCULATOR_WORKBOOKS } from "@/pages/pricing/PricingCalculator";
import { mergeItemsByName } from "./rateHelperPlumbing";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Asset = { discipline: string; items: Array<RateMasterItem & { brand?: string }>; category_configs: RateCategoryConfig[] };
const DATA = path.resolve(__dirname, "../../../../../nirmaan_stack/services/boq_rate_master/data");
const V50 = readJsonFixture<Asset>(pathToFileURL(path.join(DATA, "rate_master_hvac_all_v50.json")));
const V66 = readJsonFixture<Asset>(pathToFileURL(path.join(DATA, "rate_master_electrical_all_v66.json")));
// VRF-1 (HVAC v55; mechanical authority): the `hvac_vrf` category the registry now lists exists only from v55 on, so the sweep
// reads ITS config from v55; every other category is still read from v50 / v66 exactly as before.
const V55 = readJsonFixture<Asset>(pathToFileURL(path.join(DATA, "rate_master_hvac_all_v55.json")));
// VP-1 (HVAC v66; mechanical authority): the `hvac_valve_package` category the registry now lists exists only from v66 on, so
// the sweep reads ITS config and items from v66 (the VRF-1 idiom); `hvac_misc` is fetch_only, never on the page.
const H66 = readJsonFixture<Asset>(pathToFileURL(path.join(DATA, "rate_master_hvac_all_v66.json")));
const H66_ITEMS: RateMasterItem[] = mergeItemsByName(H66.items.map((it) => ({ ...it, discipline: H66.discipline } as RateMasterItem)));
const ADP = "hvac_adp", INS = "hvac_insulation", PIP = "hvac_piping";
const cfgOf = (a: Asset, id: string) => a.category_configs.find((c) => c.category_id === id)!;
const ITEMS: RateMasterItem[] = mergeItemsByName(V50.items.map((it) => ({ ...it, discipline: V50.discipline } as RateMasterItem)));
const E_ITEMS: RateMasterItem[] = V66.items.map((it) => ({ ...it, discipline: V66.discipline } as RateMasterItem));

/** Render the Derivation tab as the page does, and hand back the DOM. */
// DU-1 FIX-4: a category whose delegated section borrows a borrow-only category (the Valve Package -> Misc) reads that config; the
// page fetches it, this harness hands it over from the same asset (no Frappe provider here)
function renderDerivation(config: RateCategoryConfig, items: RateMasterItem[], discipline: string, sectionConfigs?: Record<string, RateCategoryConfig>) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => { root.render(createElement(RateMasterDerivation, { items, config, calculatorPage: calculatorPageLabel(discipline, CALCULATOR_WORKBOOKS), sectionConfigs })); });
  return { host, cleanup: () => { act(() => root.unmount()); host.remove(); } };
}

// ── AC1: the Derivation tab, every category ────────────────────────────────────────────────────────────────────────
describe("AC1 -- the Derivation tab is the rules listing on every category (owner D8, PA1-R)", () => {
  const pages = RATE_MASTER_DISCIPLINES.map((d) => rateMasterPageEntry(d));
  const assetOf = (disc: string) => (disc === "HVAC" ? V50 : V66);
  const itemsOf = (disc: string) => (disc === "HVAC" ? ITEMS : E_ITEMS);

  // INVERTED at VRF-1 (mechanical authority): BEFORE the title "13 Electrical + 4 HVAC categories" and `["HVAC", 4]` -- + VRF
  // INVERTED at VP-1 (HVAC v66; mechanical authority): BEFORE the title "13 Electrical + 5 HVAC categories" and `["HVAC", 5]` --
  // + the Valve Package (VP-1 QR-2 recommendation (a)); Misc is fetch_only and stays off the page
  it("the sweep names what it covers: 13 Electrical + 6 HVAC categories, every one rendered", () => {
    expect(pages.map((p) => [p.discipline, p.categories.length])).toEqual([["Electrical", 13], ["HVAC", 6]]);
    expect(pages.flatMap((p) => p.categories.map((c) => c.category_id))).not.toContain("hvac_misc");
  });

  it("POSITIVE: the pointer names the real pricing page and its tab", () => {
    expect(calculatorPageLabel("Electrical", CALCULATOR_WORKBOOKS)).toBe("Electrical Pricing");
    expect(calculatorPageLabel("HVAC", CALCULATOR_WORKBOOKS)).toBe("HVAC Pricing");
    // the tab label is the tab strip's own (PricingWorkbookPage PRICING_PAGE_TABS), pinned at the source
    const strip = fs.readFileSync(path.resolve(__dirname, "../../pricing/PricingWorkbookPage.tsx"), "utf-8");
    expect(strip).toContain(`{ id: "calculator", label: "${CALCULATOR_TAB_LABEL}" }`);
    // NEGATIVE: a discipline with no calculator gets the plain sentence, never a made-up page
    expect(calculatorPageLabel("ELV", CALCULATOR_WORKBOOKS)).toBeNull();
    expect(derivationNoticeLine(cfgOf(V66, "earthing"), null, 0)).toBe("This category's rules are not listed yet.");
  });

  it("POSITIVE + NEGATIVE, by name: each category shows its rules list OR exactly one line -- and nothing that prices", () => {
    const seen: Record<string, string> = {};
    for (const p of pages) {
      for (const c of p.categories) {
        // VRF-1: BEFORE `cfgOf(assetOf(p.discipline), c.category_id)` for every category
        // VP-1: the Valve Package from v66, config and items (BEFORE: the two-way VRF-1 choice below for every category)
        const valve = c.category_id === "hvac_valve_package";
        const config = valve ? cfgOf(H66, c.category_id) : c.category_id === "hvac_vrf" ? cfgOf(V55, c.category_id) : cfgOf(assetOf(p.discipline), c.category_id);
        const { host, cleanup } = renderDerivation(config, valve ? H66_ITEMS : itemsOf(p.discipline), p.discipline, valve ? { hvac_misc: cfgOf(H66, "hvac_misc") } : undefined);
        try {
          const list = host.querySelectorAll('[data-testid="rate-master-item-list-order"] li').length;
          const notice = host.querySelector('[data-testid="rate-master-derivation-notice"]')?.textContent ?? null;
          const rulesCard = host.querySelector('[data-testid="rate-master-rules-panel"]');
          const rules = Array.isArray(config.rules) ? config.rules.length : 0;
          // NEGATIVE, everywhere: no attribute box, no picker, no figure card, no step table, no edit pencil
          expect({ id: c.category_id, inputs: host.querySelectorAll("input, select, button, table").length }).toEqual({ id: c.category_id, inputs: 0 });
          expect(host.textContent).not.toContain("Configure attributes");
          expect(host.textContent).not.toContain("No master row");
          // exactly one of: the rules list, or one line
          expect({ id: c.category_id, both: list > 0 && notice !== null, neither: list === 0 && notice === null }).toEqual({ id: c.category_id, both: false, neither: false });
          // the extraction Rules card stays where it has rules; its empty state never sits beside the line
          // INVERTED by ELR-1 (owner Q4 "a", 2026-10-27): WAS `card: rules > 0`. NOW a category that HAS a rules list
          // draws no card (wiring_cabling); every category without a list keeps the card exactly where it has rules.
          expect({ id: c.category_id, card: !!rulesCard }).toEqual({ id: c.category_id, card: rules > 0 && list === 0 });
          if (rulesCard) expect(rulesCard.querySelectorAll("li").length).toBe(rules);
          expect(host.textContent).not.toContain("No rules configured for this category.");
          seen[`${p.discipline}/${c.category_id}`] = list > 0 ? `list ${list}` : `${notice}${rulesCard ? ` + rules ${rules}` : ""}`;
        } finally {
          cleanup();
        }
      }
    }
    const ePointer = "This category's rules are not listed yet. To see how a row is priced, open Electrical Pricing -> Calculator.";
    // ELR-4b (owner R-APPROVE + R-Q4; the P6 answer, 2026-10-29) INVERTED: WAS the eight below on the pointer line
    // (WAS shown per key); NOW each lists its rules, no pointer, no card. The pointer line itself is kept for the
    // negative half: no Electrical tab shows it any more.
    expect(Object.values(seen)).not.toContain(ePointer);
    expect(seen).toEqual({
      // INVERTED by ELR-1 (owner R-ELR0 "1 ok", R-DERIV): WAS `${ePointer} + rules 2`; NOW wiring's rules list, 13 lines
      // INVERTED by ELR-4b (WC-b / WC-c inserted): WAS "list 13"; NOW 15
      "Electrical/wiring_cabling": "list 15",
      // ELR-4b: WAS ePointer
      "Electrical/earthing": "list 3",
      // ELR-4b: WAS ePointer
      "Electrical/conduit_piping": "list 3",
      // ELR-4b: WAS `${ePointer} + rules 1`
      "Electrical/junction_box_raceway": "list 2",
      // ELR-4b: WAS `${ePointer} + rules 2`
      "Electrical/cabletray_raceway": "list 6",
      // INVERTED by ELR-4a (owner R-APPROVE + R-Q4, 2026-10-29): WAS `${ePointer} + rules 1`; NOW its rules list (this
      // test reads the older asset it names, whose configs give the counts below)
      "Electrical/popup_boxes": "list 6",
      // ELR-4b: WAS `${ePointer} + rules 1`
      "Electrical/industrial_sockets": "list 8",
      // INVERTED by ELR-4a: WAS `${ePointer} + rules 4`; NOW its rules list
      "Electrical/switches_sockets": "list 7",
      // ELR-4b: WAS `${ePointer} + rules 4`
      "Electrical/db_switchgear": "list 9",
      // ELR-4b: WAS ePointer
      "Electrical/miscellaneous": "list 2",
      // ELR-4b: WAS ePointer
      "Electrical/lighting_mgmt_system": "list 2",
      // INVERTED by ELR-4a: WAS `${ePointer} + rules 6`; NOW its rules list (12 on this older asset: its circuit length and
      // circuit stretch read literals, not Pricing Inputs (ELR-3a moved them), so those two lines have no source here)
      "Electrical/point_wiring": "list 12",
      "Electrical/electrical_pricing_inputs": PRICING_INPUTS_DERIVATION_LINE,
      "HVAC/hvac_adp": "list 38",
      // INVERTED at DU-1 FIX-1 (owner QR-1 Q1 (a), 2026-11-15: every material_text entry has its line; mechanical authority): WAS "list 43"
      "HVAC/hvac_insulation": "list 44",
      "HVAC/hvac_piping": "list 25",
      // VRF-1: the data-only VRF category has no rules list, so its tab is the one generic line -- no rules card, no inputs
      "HVAC/hvac_vrf": "This category's rules are not listed yet. To see how a row is priced, open HVAC Pricing -> Calculator.",
      "HVAC/hvac_pricing_inputs": PRICING_INPUTS_DERIVATION_LINE,
      // VP-1: the Valve Package's rules list (the 23 lines vp1RuleReachability pins one by one)
      // INVERTED at DU-1 FIX-1 / FIX-2 / FIX-4 (owner 2026-11-15 13:30-13:41 + QR-1 Q1 (a); mechanical authority): WAS "list 23" -- + the
      // drain-valve and text_notes lines, the pair-rule line, and Misc's own rules nested under its section line (each an <li>)
      "HVAC/hvac_valve_package": "list 43",
    });
  });

  it("POSITIVE: the rules list on the tab IS itemListRuleOrder's, line for line (ADP, Insulation, Piping)", () => {
    for (const id of [ADP, INS, PIP]) {
      const { host, cleanup } = renderDerivation(cfgOf(V50, id), ITEMS, "HVAC");
      try {
        const shown = Array.from(host.querySelectorAll('[data-testid="rate-master-item-list-order"] li')).map((li) => li.textContent);
        const want = itemListRuleOrder(cfgOf(V50, id), ITEMS).map((l) => `${l.n}${l.title}${l.detail ? ` — ${l.detail}` : ""}`);
        expect(shown).toEqual(want);
      } finally {
        cleanup();
      }
    }
  });
});

