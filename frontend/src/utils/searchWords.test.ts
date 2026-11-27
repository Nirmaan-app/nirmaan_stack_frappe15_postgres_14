import { describe, expect, it } from "vitest";

import { hasAllWords, searchWords } from "./searchWords";

describe("searchWords", () => {
  it("lower-cases and splits on any whitespace", () => {
    expect(searchWords("  MCB \t 32a\n")).toEqual(["mcb", "32a"]);
  });
  it("gives no words for blank, null or undefined", () => {
    expect(searchWords("")).toEqual([]);
    expect(searchWords("   ")).toEqual([]);
    expect(searchWords(null)).toEqual([]);
    expect(searchWords(undefined)).toEqual([]);
  });
});

describe("hasAllWords", () => {
  it("matches everything with no words", () => {
    expect(hasAllWords([], [])).toBe(true);
    expect(hasAllWords(["anything"], [])).toBe(true);
  });
  it("needs every word, ignoring case, in any field", () => {
    expect(hasAllWords(["HVAC Ducting", "Grill/Diffuser Installation"], ["hvac", "diffuser"])).toBe(true);
    expect(hasAllWords(["HVAC Ducting", "Grill/Diffuser Installation"], ["hvac", "plumbing"])).toBe(false);
  });
  it("matches part of a word", () => {
    expect(hasAllWords(["Reception Area"], ["recep"])).toBe(true);
  });
  it("skips empty fields and never matches across two fields", () => {
    expect(hasAllWords([null, undefined, "", "VAV"], ["vav"])).toBe(true);
    expect(hasAllWords(["Ducting", "Installation"], ["ductinginstallation"])).toBe(false);
  });
});
