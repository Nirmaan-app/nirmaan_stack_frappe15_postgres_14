import { describe, expect, it } from "vitest";

import { pendingAssetActionsLabel } from "./PendingDeclarationIcon";

describe("the pending-asset hover text", () => {
  it("is unchanged with no audit overdue", () => {
    expect(pendingAssetActionsLabel(1, 0)).toBe("Asset declaration pending. Click to sign it.");
    expect(pendingAssetActionsLabel(0, 1)).toBe("Asset audit pending. Click to submit it.");
    expect(pendingAssetActionsLabel(0, 3)).toBe("3 asset audits pending. Click to submit them.");
    expect(pendingAssetActionsLabel(2, 1)).toBe("2 asset declarations and 1 asset audit pending. Click to open your assets.");
  });

  it("says overdue when every audit is", () => {
    expect(pendingAssetActionsLabel(0, 1, true, 1)).toBe("Asset audit overdue. Click to submit it.");
    expect(pendingAssetActionsLabel(0, 2, true, 2)).toBe("2 asset audits overdue. Click to submit them.");
  });

  it("says how many are overdue when only some are", () => {
    expect(pendingAssetActionsLabel(0, 3, true, 1)).toBe("3 asset audits pending, 1 overdue. Click to submit them.");
  });

  it("keeps 'overdue' off the declarations when both are waiting", () => {
    expect(pendingAssetActionsLabel(1, 1, true, 1)).toBe(
      "1 asset declaration pending; 1 asset audit overdue. Click to open your assets."
    );
    expect(pendingAssetActionsLabel(2, 3, true, 1)).toBe(
      "2 asset declarations pending; 3 asset audits pending, 1 overdue. Click to open your assets."
    );
  });

  it("drops 'Click to ...' for someone else's profile", () => {
    expect(pendingAssetActionsLabel(0, 1, false, 1)).toBe("Asset audit overdue.");
    expect(pendingAssetActionsLabel(1, 2, false, 2)).toBe("1 asset declaration pending; 2 asset audits overdue.");
  });

  it("never claims more overdue than pending, and ignores overdue with no audits", () => {
    expect(pendingAssetActionsLabel(0, 1, true, 5)).toBe("Asset audit overdue. Click to submit it.");
    expect(pendingAssetActionsLabel(1, 0, true, 2)).toBe("Asset declaration pending. Click to sign it.");
  });
});
