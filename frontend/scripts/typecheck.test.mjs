// The baseline key ignores the order tsc prints a union's members in (scripts/typecheck.mjs `unionsSorted`).
import { describe, expect, it } from "vitest";

import { countByKey, keyOf, unionsSorted } from "./typecheck.mjs";

const error = (message) => ({ path: "src/a.tsx", code: "TS2322", message });

describe("unionsSorted", () => {
  it("gives two orders of one union the same key", () => {
    expect(unionsSorted("Type 'string | null' is not assignable to type 'string | undefined'.")).toBe(
      unionsSorted("Type 'null | string' is not assignable to type 'undefined | string'."),
    );
  });

  it("sorts unions inside objects, arrays, tuples, generics and function types", () => {
    const a =
      "Argument of type '{ fields: (\"name\" | \"custom\")[]; filters: ([\"status\", \"=\", string] | [\"vendor\", \"=\", string])[]; } | null' " +
      "is not assignable to parameter of type 'Promise<A | B>' or '(x: C | D) => E | F'.";
    const b =
      "Argument of type 'null | { fields: (\"custom\" | \"name\")[]; filters: ([\"vendor\", \"=\", string] | [\"status\", \"=\", string])[]; }' " +
      "is not assignable to parameter of type 'Promise<B | A>' or '(x: D | C) => F | E'.";
    expect(unionsSorted(a)).toBe(unionsSorted(b));
  });

  it("keeps what is not a union order: member order, names and other text", () => {
    expect(unionsSorted("Type '{ a: string; b: number; }' is missing 'c'.")).toBe(
      "Type '{ a: string; b: number; }' is missing 'c'.",
    );
    expect(unionsSorted("Type '{ a: X | Y; }'")).not.toBe(unionsSorted("Type '{ b: X | Y; }'"));
    expect(unionsSorted("Type '\"a|b\" | \"c\"'")).toBe("Type '\"a|b\" | \"c\"'");
    const once = unionsSorted("Type '{ value: string | undefined; label: B | A; } | null'");
    expect(once).toBe("Type 'null | { value: string | undefined; label: A | B; }'");
    expect(unionsSorted(once)).toBe(once);
  });

  it("still tells a different union apart", () => {
    expect(unionsSorted("Type 'string | null'")).not.toBe(unionsSorted("Type 'string | undefined'"));
  });

  it("sorts each line of a multi-line message", () => {
    expect(unionsSorted("Type 'B | A' is wrong.\n  Type 'D | C' is wrong.")).toBe(
      "Type 'A | B' is wrong.\n  Type 'C | D' is wrong.",
    );
  });
});

describe("the baseline count", () => {
  it("counts two spellings of one error under one key and keeps the first spelling", () => {
    const counts = countByKey([error("Type 'B | A'."), error("Type 'A | B'.")]);
    expect(counts.size).toBe(1);
    expect([...counts.values()][0]).toEqual({ ...error("Type 'B | A'."), count: 2 });
    expect(counts.has(keyOf(error("Type 'A | B'.")))).toBe(true);
  });
});
