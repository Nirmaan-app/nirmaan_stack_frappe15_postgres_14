import { describe, expect, expectTypeOf, it } from "vitest";
import { parseJson } from "./parseJson";

describe("parseJson", () => {
  it("returns the value a valid JSON text holds, typed unknown", () => {
    const value = parseJson('{"customer":"Acme Builders","items":[1,2]}');
    expectTypeOf(value).toEqualTypeOf<unknown>();
    expect(value).toEqual({ customer: "Acme Builders", items: [1, 2] });
  });

  it("throws a SyntaxError on invalid JSON, as JSON.parse does", () => {
    expect(() => parseJson("{customer: 'Acme Builders'}")).toThrow(SyntaxError);
  });

  it("throws a SyntaxError on the empty string, never returning undefined", () => {
    expect(() => parseJson("")).toThrow(SyntaxError);
  });
});
