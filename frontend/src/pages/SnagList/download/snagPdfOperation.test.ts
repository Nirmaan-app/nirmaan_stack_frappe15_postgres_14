import { describe, expect, it } from "vitest";

import { snagPdfContextOf, snagPdfProgressText } from "./snagPdfOperation";

const OP = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";

describe("snagPdfProgressText: what the Generating PDF toast says while the operation is under way", () => {
  it("says it waits for the server while the operation is queued", () => {
    expect(snagPdfProgressText({ phase: "queued", opId: OP })).toBe("Waiting for the server to start on it...");
  });

  it("counts the sections of a Download All as they are built", () => {
    expect(snagPdfProgressText({
      phase: "running", opId: OP, progress: { percent: 40, message: null, detail: { done: 2, total: 5 } },
    })).toBe("Built 2 of 5 sections...");
  });

  it("says it builds the PDF for a single render, or before any progress", () => {
    expect(snagPdfProgressText({
      phase: "running", opId: OP, progress: { percent: 0, message: null, detail: { done: 0, total: 1 } },
    })).toBe("Building the PDF...");
    expect(snagPdfProgressText({ phase: "running", opId: OP, progress: null })).toBe("Building the PDF...");
    expect(snagPdfProgressText({ phase: "starting", opId: OP })).toBe("Building the PDF...");
  });
});

describe("snagPdfContextOf: what a download started with, kept across a reload", () => {
  it("reads the label and the report type back", () => {
    expect(snagPdfContextOf({ label: "Tower A", isSummary: true })).toEqual({ label: "Tower A", isSummary: true });
  });

  it("is null for anything else", () => {
    expect(snagPdfContextOf(undefined)).toBeNull();
    expect(snagPdfContextOf({ label: "Tower A" })).toBeNull();
  });
});
