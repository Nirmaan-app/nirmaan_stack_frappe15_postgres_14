// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { deliverTdsExport } from "./deliverTdsExport";

const result = { failed_items: ["AHU-2"], file: { filename: "TDS_Report_Tower_A_2026-11-19.pdf", size_bytes: 3 } };

describe("deliverTdsExport", () => {
  let saved: { href: string; download: string | null }[];
  let revoked: string[];

  beforeEach(() => {
    saved = [];
    revoked = [];
    vi.stubGlobal("fetch", vi.fn(async () => new Response("pdf", { status: 200 })));
    // jsdom has no object URLs.
    window.URL.createObjectURL = () => "blob:tds-1";
    window.URL.revokeObjectURL = (url: string) => { revoked.push(url); };
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      saved.push({ href: this.href, download: this.getAttribute("download") });
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("a download saves the server's file under its name and frees the blob at once", async () => {
    expect(await deliverTdsExport("op-1", result, { previewOnly: false, fallbackName: "x.pdf" }))
      .toEqual({ preview: null, failedItems: ["AHU-2"] });
    expect(saved).toEqual([{ href: "blob:tds-1", download: "TDS_Report_Tower_A_2026-11-19.pdf" }]);
    expect(revoked).toEqual(["blob:tds-1"]);
  });

  it("a preview holds the PDF in memory, unsaved and not freed", async () => {
    expect(await deliverTdsExport("op-1", result, { previewOnly: true, fallbackName: "x.pdf" })).toEqual({
      preview: { blobUrl: "blob:tds-1", filename: "TDS_Report_Tower_A_2026-11-19.pdf", sizeBytes: 3 },
      failedItems: ["AHU-2"],
    });
    expect(saved).toEqual([]);
    expect(revoked).toEqual([]);
  });
});
