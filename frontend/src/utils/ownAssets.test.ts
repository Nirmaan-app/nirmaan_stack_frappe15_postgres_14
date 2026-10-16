import { describe, expect, it } from "vitest";

import { withOwnAssets } from "./ownAssets";

const a = (name: string) => ({ name });

describe("withOwnAssets", () => {
  it("adds the person's own assets the list missed and marks them as without a page", () => {
    const { assets, withoutPage } = withOwnAssets([a("LAP-1"), a("CRI-2")], [a("CRI-2"), a("ANE-9")]);
    expect(assets?.map((x) => x.name)).toEqual(["LAP-1", "CRI-2", "ANE-9"]);
    expect([...withoutPage]).toEqual(["ANE-9"]);
  });

  it("changes nothing when the list already has every own asset, or there are none", () => {
    expect(withOwnAssets([a("LAP-1")], [a("LAP-1")]).withoutPage.size).toBe(0);
    expect(withOwnAssets([a("LAP-1")], undefined).assets?.map((x) => x.name)).toEqual(["LAP-1"]);
    expect(withOwnAssets([a("LAP-1")], []).withoutPage.size).toBe(0);
  });

  it("does not mark anything as without a page while the list is still loading", () => {
    const { assets, withoutPage } = withOwnAssets(undefined, [a("ANE-9")]);
    expect(assets?.map((x) => x.name)).toEqual(["ANE-9"]);
    expect(withoutPage.size).toBe(0);
  });
});
