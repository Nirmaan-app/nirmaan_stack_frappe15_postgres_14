import { describe, expect, it } from "vitest";

import { assetTabToOpen, canSignDeclaration, countDeclarationsToSign } from "./assetDeclaration";

const base = {
  viewerId: "kiran@nirmaan.app",
  assignedTo: "kiran@nirmaan.app",
  currentAssignee: "kiran@nirmaan.app",
  declaration: null,
};

describe("canSignDeclaration", () => {
  it("lets the assignee sign a pending declaration", () => {
    expect(canSignDeclaration(base)).toBe(true);
  });

  it("hides Sign from anyone else, HR included", () => {
    expect(canSignDeclaration({ ...base, viewerId: "hr@nirmaan.app" })).toBe(false);
  });

  it("hides Sign once a declaration is attached", () => {
    expect(canSignDeclaration({ ...base, declaration: "/api/method/x?key=a.pdf" })).toBe(false);
  });

  it("hides Sign when the asset names a different holder", () => {
    expect(canSignDeclaration({ ...base, currentAssignee: "other@nirmaan.app" })).toBe(false);
    expect(canSignDeclaration({ ...base, currentAssignee: null })).toBe(false);
  });

  it("hides Sign while the user or the assignment is still loading", () => {
    expect(canSignDeclaration({ ...base, viewerId: undefined })).toBe(false);
    expect(canSignDeclaration({ ...base, assignedTo: undefined, currentAssignee: undefined })).toBe(false);
  });
});

describe("countDeclarationsToSign (the app access gate's count)", () => {
  const me = "sharook@nirmaan.app";
  const row = (asset: string, declaration: string | null = null) => ({
    asset,
    asset_assigned_to: me,
    asset_declaration_attachment: declaration,
  });

  it("counts an unsigned asset I hold", () => {
    expect(countDeclarationsToSign(me, [row("ASSET-1")], new Set(["ASSET-1"]))).toBe(1);
  });

  it("skips a leftover row for an asset someone else holds now (ASSET-LAP-029)", () => {
    expect(countDeclarationsToSign(me, [row("ASSET-LAP-029")], new Set())).toBe(0);
  });

  it("skips one already signed or uploaded", () => {
    expect(countDeclarationsToSign(me, [row("ASSET-1", "/files/signed.pdf")], new Set(["ASSET-1"]))).toBe(0);
  });

  it("counts only the signable ones among several", () => {
    const rows = [row("ASSET-1"), row("ASSET-2"), row("ASSET-LAP-029"), row("ASSET-3", "/files/x.pdf")];
    expect(countDeclarationsToSign(me, rows, new Set(["ASSET-1", "ASSET-2", "ASSET-3"]))).toBe(2);
  });
});

describe("assetTabToOpen", () => {
  it("opens the tab with a declaration waiting, Project first", () => {
    expect(assetTabToOpen({ total: 1, pending: 1 }, { total: 1, pending: 0 })).toBe("Project");
    expect(assetTabToOpen({ total: 1, pending: 0 }, { total: 2, pending: 1 })).toBe("IT");
    expect(assetTabToOpen({ total: 1, pending: 1 }, { total: 1, pending: 1 })).toBe("Project");
  });

  it("with nothing waiting, opens Project unless the person holds only IT assets", () => {
    expect(assetTabToOpen({ total: 2, pending: 0 }, { total: 3, pending: 0 })).toBe("Project");
    expect(assetTabToOpen({ total: 0, pending: 0 }, { total: 3, pending: 0 })).toBe("IT");
    expect(assetTabToOpen({ total: 0, pending: 0 }, { total: 0, pending: 0 })).toBe("Project");
  });
});
