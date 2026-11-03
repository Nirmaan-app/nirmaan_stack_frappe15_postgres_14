// RM-ACCESS-1 (owner 2026-10-20 11:29 / 12:09): the Rate Master tab, page and freeze read are ADMIN ONLY
// (Nirmaan Admin Profile + Administrator); Estimates lose their read-only view; the pricing reads stay open,
// so the BoQ pricing panel and the calculator keep pricing for every user who prices today.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { ADMIN_PROFILE, RATE_MASTER_ACCESS, UPLOAD_BOQ_ACCESS, isNirmaanAdmin } from "@/constants/roles";
import { roleRouteState } from "@/utils/auth/ProtectedRoute";
import type { Pipeline, RateCategoryConfig, RateMasterItem } from "./rateMasterTypes";
import { buildExtractionByRow, makePricingSheetHelper } from "@/pages/boq-wizard/rate-helper/pricingSheetHelper";
import { isSuggestion, type ExtractionRow } from "@/pages/boq-wizard/rate-helper/rateHelperTypes";

const SRC = join(__dirname, "..", "..", "..");
const read = (...p: string[]) => readFileSync(join(SRC, ...p), "utf8");

const ESTIMATES = "Nirmaan Estimates Executive Profile";
const PMO = "Nirmaan PMO Executive Profile";
const PLAIN = "Nirmaan Project Manager Profile";

/** [role, user_id, may see the Rate Master] -- the populations the brief names, both directions. */
const POPULATION: Array<[string, string, boolean]> = [
  [ADMIN_PROFILE, "admin@nirmaan.app", true],
  [ADMIN_PROFILE, "Administrator", true], // useUserData maps Administrator to the Admin profile
  ["", "Administrator", true],            // the sidebar's own role state is null/"" for Administrator
  [ESTIMATES, "est@nirmaan.app", false],  // LOSES the read-only view (owner ruling 1)
  [PMO, "pmo@nirmaan.app", false],
  [PLAIN, "pm@nirmaan.app", false],
  ["", "someone@nirmaan.app", false],
  ["Error", "someone@nirmaan.app", false],
];

describe("RM-ACCESS-1: the one Rate Master admin check", () => {
  it("the list is exactly the Admin profile (Administrator passes by user id)", () => {
    expect([...RATE_MASTER_ACCESS]).toEqual([ADMIN_PROFILE]);
    expect(RATE_MASTER_ACCESS).not.toContain(ESTIMATES);
  });

  it("POSITIVE + NEGATIVE: isNirmaanAdmin per role (sidebar entry, edit and freeze controls, freeze read)", () => {
    for (const [role, uid, want] of POPULATION) {
      expect(isNirmaanAdmin(role, uid), `${role || "(none)"} / ${uid}`).toBe(want);
    }
    expect(isNirmaanAdmin(null, "Administrator")).toBe(true);
    expect(isNirmaanAdmin(null, "someone@nirmaan.app")).toBe(false);
    expect(isNirmaanAdmin("Loading", "someone@nirmaan.app")).toBe(false); // never flashes in
  });

  it("POSITIVE + NEGATIVE: the route guard admits exactly the same population, and loads while the role loads", () => {
    for (const [role, uid, want] of POPULATION) {
      expect(roleRouteState(role, uid, RATE_MASTER_ACCESS), `${role || "(none)"} / ${uid}`).toBe(want ? "allow" : "deny");
    }
    expect(roleRouteState("Loading", "someone@nirmaan.app", RATE_MASTER_ACCESS)).toBe("loading");
  });

  it("the predicate and the route agree for every role (rateMasterEdit no longer carries its own check)", () => {
    for (const [role, uid] of POPULATION) {
      expect(isNirmaanAdmin(role, uid), `${role || "(none)"} / ${uid}`)
        .toBe(roleRouteState(role, uid, RATE_MASTER_ACCESS) === "allow");
    }
    expect(read("pages", "pricing", "rate-master", "rateMasterEdit.ts")).not.toContain("export function isRateMasterAdmin");
  });
});

describe("RM-ACCESS-1: the route and the sidebar entry", () => {
  const routes = read("components", "helpers", "routesConfig.tsx");
  const rmBlock = routes.slice(routes.indexOf('path: "rate-master"'), routes.indexOf("RateMasterPage"));

  it("the /rate-master route is a RoleRoute on RATE_MASTER_ACCESS (the app's Access Denied pattern)", () => {
    expect(rmBlock).toContain('<RoleRoute allowed={RATE_MASTER_ACCESS} what="the Rate Master" />');
    // INVERTED (was `element: <PricingRoute />` -- Admin + Estimates)
    expect(rmBlock).not.toContain("PricingRoute");
  });

  it("NEGATIVE: the pricing workbooks (the calculator) keep PricingRoute -- Estimates still price there", () => {
    for (const path of ["hvac-pricing", "electrical-pricing", "elv-pricing"]) {
      const at = routes.indexOf(`path: "${path}"`);
      expect(at, path).toBeGreaterThan(-1);
      expect(routes.slice(at, at + 120), path).toContain("element: <PricingRoute />");
    }
    const guard = read("utils", "auth", "ProtectedRoute.tsx");
    expect(guard).toContain('role === "Nirmaan Estimates Executive Profile"');
  });

  it("the sidebar entry is gated by isNirmaanAdmin, no longer by the pricing-workbook gate", () => {
    const side = read("components", "layout", "NewSidebar.tsx");
    const at = side.indexOf('{ key: "/rate-master", icon: Table2, label: "Rate Master" }');
    expect(at).toBeGreaterThan(-1);
    const gate = side.slice(side.lastIndexOf("...(", at), at);
    expect(gate).toContain("isNirmaanAdmin(role, user_id)");
    // INVERTED: the old gate (Admin + Estimates) is gone from the Rate Master item
    expect(gate).not.toContain("Nirmaan Estimates Executive Profile");
  });

  it("SWEEP: no other in-app link to the Rate Master (every non-test .ts/.tsx under src/, by name)", () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) { walk(p); continue; }
        if (!/\.tsx?$/.test(f) || /\.test\.tsx?$/.test(f)) continue;
        // code only: a doc comment naming the route is not a door
        const code = readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
        if (/["'`]\/rate-master|RATE_MASTER_ROUTE/.test(code)) hits.push(relative(SRC, p).replace(/\\/g, "/"));
      }
    };
    walk(SRC);
    // NewSidebar: the gated item + its two active-key maps (no link); the registry: the constant's definition,
    // referenced nowhere else. Any new file here is a new door -- gate it with isNirmaanAdmin.
    expect(hits.sort()).toEqual(["components/layout/NewSidebar.tsx", "pages/pricing/rate-master/rateMasterRegistry.ts"]);
    const side = read("components", "layout", "NewSidebar.tsx");
    expect(side.match(/"\/rate-master"/g)?.length).toBe(2); // the item + the path-key map
  }, 60_000);
});

describe("RM-ACCESS-1: the freeze read", () => {
  it("the page calls it only for an admin (null SWR key otherwise)", () => {
    const page = read("pages", "pricing", "rate-master", "RateMasterPage.tsx");
    expect(page).toContain('FREEZE_STATE_METHOD, undefined, isAdmin ? "rate-master-freeze" : null)');
    // INVERTED: the unconditional call is gone
    expect(page).not.toContain('(FREEZE_STATE_METHOD, undefined, "rate-master-freeze")');
    expect(page.match(/FREEZE_STATE_METHOD/g)?.length).toBe(2); // the constant + the one call
  });

  it("NEGATIVE: nothing on a pricing surface reads it", () => {
    for (const f of [
      ["pages", "boq-wizard", "SheetPricingPage.tsx"],
      ["pages", "boq-wizard", "rate-helper", "rateHelperPlumbing.tsx"],
      ["pages", "boq-wizard", "rate-helper", "RateHelperPanel.tsx"],
      ["pages", "pricing", "PricingCalculator.tsx"],
      ["pages", "pricing", "PricingWorkbookPage.tsx"],
    ]) {
      expect(read(...f), f.join("/")).not.toContain("get_rate_master_freeze");
    }
  });
});

describe("RM-ACCESS-1: the pricing panel still prices for a non-admin", () => {
  const PIPELINES: Record<string, Pipeline> = {
    cable_boq: {
      output: ["supply_per_mtr", "install_per_mtr"],
      steps: [
        { step: "match_master_row", params: { kind: "cable" } },
        {
          step: "apply_effective_multiplier", target: "list_price_per_mtr", result: "supply_per_mtr",
          conditions: [{ when: { insulation: "UNARMOURED" }, params: { discount: 0.57, markup: 0.4 } }],
          formula: "(1-discount)*(1+markup)",
        },
        { step: "roundup", target: "supply_per_mtr", params: { digits: -1 } },
        { step: "scale", target: "install_base_per_mtr", result: "install_per_mtr", params: { install_markup: 1.0 }, formula: "base*(1+install_markup)" },
        { step: "roundup", target: "install_per_mtr", params: { digits: 0 } },
      ],
    },
  };
  const CONFIG: RateCategoryConfig = {
    discipline: "Electrical", category_id: "wiring_cabling",
    attribute_definitions: [
      { id: "material", label: "Material", type: "choice", values: ["ALUMINIUM", "COPPER"] },
      { id: "insulation", label: "Insulation", type: "choice", values: ["ARMOURED", "UNARMOURED"] },
      { id: "core", label: "Core", type: "number" },
      { id: "thickness_sqmm", label: "Thickness (sqmm)", type: "number" },
    ],
    pipelines: PIPELINES,
  };
  const ITEMS: RateMasterItem[] = [{
    discipline: "Electrical", kind: "cable", brand: "Polycab", unit: "Mtr",
    attributes: { material: "COPPER", insulation: "UNARMOURED", core: 1, thickness_sqmm: 6 },
    rates: { list_price_per_mtr: 192, install_base_per_mtr: 10 },
  }];
  const ext = (a: Record<string, string | number>): ExtractionRow["attributes"] =>
    Object.fromEntries(Object.entries(a).map(([k, v]) => [k, { value: v, confidence: 0.9, corroborated: true }]));

  it("POSITIVE: the panel's entry point prices a row with no role anywhere in its input (120 / 20)", () => {
    // The panel's route is UPLOAD_BOQ_ACCESS, which keeps Estimates; the Rate Master list does not gate it.
    expect(UPLOAD_BOQ_ACCESS).toContain(ESTIMATES);
    expect(isNirmaanAdmin(ESTIMATES, "est@nirmaan.app")).toBe(false);
    const map = buildExtractionByRow([
      { excel_row: 2, description: "1C x 6 sqmm cable", attributes: ext({ material: "COPPER", insulation: "UNARMOURED", core: 1, thickness_sqmm: 6 }) },
    ]);
    const helper = makePricingSheetHelper({ config: CONFIG, items: ITEMS, extractionByRow: map });
    const r = helper.compute({ excelRow: 2, description: "1C x 6 sqmm cable", nodeType: "Line Item", category: "wiring_cabling", discipline: "Electrical", rateKinds: ["supply_rate", "install_rate"] });
    expect(isSuggestion(r)).toBe(true);
    if (!isSuggestion(r)) return;
    expect(r.values.supply_rate).toBe(120);
    expect(r.values.install_rate).toBe(20);
  });

  it("NEGATIVE: no pricing module consults the Rate Master admin check, and they read only the two open endpoints", () => {
    const files = [
      ["pages", "boq-wizard", "rate-helper", "pricingSheetHelper.ts"],
      ["pages", "boq-wizard", "rate-helper", "itemListPricing.ts"],
      ["pages", "boq-wizard", "rate-helper", "rateHelperPlumbing.tsx"],
      ["pages", "boq-wizard", "rate-helper", "RateHelperPanel.tsx"],
      ["pages", "pricing", "PricingCalculator.tsx"],
    ];
    for (const f of files) {
      const src = read(...f);
      for (const banned of ["isNirmaanAdmin", "RATE_MASTER_ACCESS", "rateMasterEdit"]) {
        expect(src, `${f.join("/")} names ${banned}`).not.toContain(banned);
      }
    }
    const plumbing = read("pages", "boq-wizard", "rate-helper", "rateHelperPlumbing.tsx");
    expect(plumbing).toContain("nirmaan_stack.api.boq.rate_master.get_rate_category_config");
    expect(plumbing).toContain("nirmaan_stack.api.boq.rate_master.get_rate_master_items");
  });
});
