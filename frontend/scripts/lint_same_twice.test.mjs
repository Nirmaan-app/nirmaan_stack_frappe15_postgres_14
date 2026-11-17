// lint_same_twice.mjs: does the type-aware lint give one answer every run (ADR-0049, #1699)?
import { describe, expect, it } from "vitest";
import { changedFiles } from "./lint_same_twice.mjs";

/** One oxlint `-f json` diagnostic, as much of it as the comparison reads. */
const finding = (filename, code, offset) => ({ filename, code, labels: [{ span: { offset, length: 3 } }] });

describe("changedFiles", () => {
  it("names nothing when two runs report the same findings in another order", () => {
    const a = [finding("src/a.ts", "typescript(no-unsafe-call)", 10), finding("src/b.ts", "typescript(no-explicit-any)", 4)];
    expect(changedFiles(a, [...a].reverse())).toEqual([]);
  });

  it("names the file whose finding appears in one run only", () => {
    const a = [finding("src/a.ts", "typescript(no-unsafe-call)", 10)];
    const b = [...a, finding("src/table.tsx", "typescript(no-unsafe-return)", 215)];
    expect(changedFiles(a, b)).toEqual(["src/table.tsx"]);
  });

  it("names a file whose finding moved to another place, and one reported a second time", () => {
    const a = [finding("src/a.ts", "typescript(no-unsafe-call)", 10), finding("src/b.ts", "typescript(no-explicit-any)", 4)];
    const b = [
      finding("src/a.ts", "typescript(no-unsafe-call)", 11),
      finding("src/b.ts", "typescript(no-explicit-any)", 4),
      finding("src/b.ts", "typescript(no-explicit-any)", 4),
    ];
    expect(changedFiles(a, b)).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("names a file whose finding changed rule at the same place", () => {
    const a = [finding("src/a.ts", "typescript(no-unsafe-call)", 10)];
    const b = [finding("src/a.ts", "typescript(no-unsafe-member-access)", 10)];
    expect(changedFiles(a, b)).toEqual(["src/a.ts"]);
  });
});
