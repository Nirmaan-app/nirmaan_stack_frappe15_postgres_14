import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { BILLABLE, TDS_EXCLUDED_CATEGORIES, isTdsMemberEligible } from "./tdsMemberEligibility";

describe("isTdsMemberEligible", () => {
  it("offers a Billable SKU from an ordinary category", () => {
    expect(isTdsMemberEligible({ category: "Fans", billing_category: "Billable" }, true)).toBe(true);
  });

  it("refuses a Non-Billable SKU when billableOnly is on", () => {
    expect(isTdsMemberEligible({ category: "Lugs & Glands", billing_category: "Non-Billable" }, true)).toBe(false);
  });

  it("refuses a SKU with no billing category when billableOnly is on", () => {
    expect(isTdsMemberEligible({ category: "Fans", billing_category: null }, true)).toBe(false);
  });

  it("offers a Non-Billable SKU when billableOnly is off", () => {
    expect(isTdsMemberEligible({ category: "Lugs & Glands", billing_category: "Non-Billable" }, false)).toBe(true);
  });

  it("refuses an excluded category even when the SKU is Billable", () => {
    // Most HVAC Junk SKUs are marked Billable, so the billable rule alone would let them through.
    expect(isTdsMemberEligible({ category: "HVAC Junk", billing_category: "Billable" }, true)).toBe(false);
    expect(isTdsMemberEligible({ category: "HVAC Junk", billing_category: "Billable" }, false)).toBe(false);
    expect(isTdsMemberEligible({ category: "Additional Charges", billing_category: "Non-Billable" }, false)).toBe(false);
  });
});

describe("parity with api/tds/linking.py", () => {
  const LINKING_PY = readFileSync(resolve(__dirname, "../../../nirmaan_stack/api/tds/linking.py"), "utf-8");

  it("the excluded categories match", () => {
    const m = LINKING_PY.match(/^TDS_EXCLUDED_CATEGORIES\s*=\s*\(([^)]*)\)/m);
    expect(m, "TDS_EXCLUDED_CATEGORIES not found in linking.py").toBeTruthy();
    const pyList = [...m![1].matchAll(/"([^"]*)"/g)].map((x) => x[1]);
    expect([...pyList].sort()).toEqual([...TDS_EXCLUDED_CATEGORIES].sort());
  });

  it("the Billable value matches", () => {
    const m = LINKING_PY.match(/^BILLABLE\s*=\s*"([^"]*)"/m);
    expect(m, "BILLABLE not found in linking.py").toBeTruthy();
    expect(m![1]).toBe(BILLABLE);
  });
});
