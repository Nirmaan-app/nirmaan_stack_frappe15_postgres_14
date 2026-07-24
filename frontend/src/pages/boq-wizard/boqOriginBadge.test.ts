// Unit tests for the shared BoQ Type badge (originBadge).
//
// What we pin: the mapping the BoQ LIST has shipped all along, now that the revise-picker
// reads the same function. If these labels/variants ever drift, the two surfaces disagree --
// which is precisely what extracting this module exists to prevent.
import { describe, it, expect } from "vitest";
import { originBadge } from "./boqOriginBadge";

describe("originBadge -- the three known origins", () => {
  it("maps upload to a neutral Original Upload badge", () => {
    expect(originBadge("upload")).toEqual({
      label: "Original Upload",
      variant: "outline",
    });
  });

  it("maps revision to the orange Revised Upload badge", () => {
    expect(originBadge("revision")).toEqual({
      label: "Revised Upload",
      variant: "orange",
    });
  });

  it("maps template to the purple Template badge", () => {
    expect(originBadge("template")).toEqual({
      label: "Template",
      variant: "purple",
    });
  });
});

describe("originBadge -- pre-field rows read as an upload", () => {
  const blanks: (string | null | undefined)[] = [undefined, null, "", "   "];
  it.each(blanks)("treats %p as upload", (raw) => {
    expect(originBadge(raw).label).toBe("Original Upload");
  });

  it("trims a padded value rather than falling through to the raw string", () => {
    expect(originBadge("  revision  ")).toEqual({
      label: "Revised Upload",
      variant: "orange",
    });
  });
});

describe("originBadge -- an origin this module has not seen", () => {
  it("renders the raw value instead of an empty badge", () => {
    expect(originBadge("import")).toEqual({ label: "import", variant: "outline" });
  });

  it("is case-sensitive -- a differently-cased value is unknown, not a match", () => {
    expect(originBadge("Revision").label).toBe("Revision");
  });
});
