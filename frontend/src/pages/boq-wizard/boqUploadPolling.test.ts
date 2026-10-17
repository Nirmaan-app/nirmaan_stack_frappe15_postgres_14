import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The upload screen is not mounted here (no DOM); this reads its source. Covers BoqUploadScreen.tsx.
describe("upload status keeps polling while the tab is hidden (S6 F10 / U9)", () => {
  const src = readFileSync(join(__dirname, "BoqUploadScreen.tsx"), "utf8");

  it("the get_upload_status poll sets refreshWhenHidden (SWR stops hidden polling by default)", () => {
    const call = src.indexOf('"nirmaan_stack.api.boq.wizard.upload_file.get_upload_status"');
    const opts = src.indexOf("{ refreshInterval: shouldPoll ? 3000 : 0, refreshWhenHidden: true }");
    expect(call).toBeGreaterThan(0);
    expect(opts).toBeGreaterThan(call);
    expect(opts - call).toBeLessThan(400);
  });

  it("negative: the poll still runs only while parsing (no poll, hidden or not, when idle)", () => {
    expect(src).toContain('const shouldPoll = uploadStatus === "parsing" && !!jobId;');
    expect(src).toContain("shouldPoll ? `boq-upload-status::${jobId}` : null,");
  });
});
