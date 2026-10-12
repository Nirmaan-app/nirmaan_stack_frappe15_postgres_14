import { describe, expect, it } from "vitest";

import { canSignDeclaration } from "./assetDeclaration";

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
