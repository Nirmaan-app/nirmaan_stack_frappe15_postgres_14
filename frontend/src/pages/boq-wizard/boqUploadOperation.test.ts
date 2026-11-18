import { describe, expect, it } from "vitest";

import { uploadOutcome, uploadedFileOf } from "./boqUploadOperation";

const OP = "0b6f3f3e-2f53-4d7e-9a43-3d1c0e5b8a11";

describe("uploadOutcome: what an upload operation's view means on the upload screen", () => {
  it("tells waiting in the queue apart from parsing", () => {
    expect(uploadOutcome({ phase: "starting", opId: OP }).status).toBe("uploading");
    expect(uploadOutcome({ phase: "queued", opId: OP }).status).toBe("queued");
    expect(uploadOutcome({ phase: "running", opId: OP, progress: null }).status).toBe("parsing");
  });

  it("a finished parse that made a BoQ is done, with that BoQ", () => {
    expect(uploadOutcome({ phase: "finished", opId: OP, result: { status: "success", boq_name: "BOQ-26-00007" } }))
      .toEqual({ status: "done", boqName: "BOQ-26-00007", error: null });
  });

  it("a finished parse that could not read the workbook shows the workbook's own error", () => {
    const finished = (code: string) => uploadOutcome({
      phase: "finished", opId: OP, result: { status: "error", error_code: code },
    }).status;
    expect(finished("corrupted")).toBe("error-E");
    expect(finished("zero_sheets")).toBe("error-F");
    expect(finished("something_new")).toBe("error-internal");
  });

  it("a failed or lost operation shows the server's words", () => {
    expect(uploadOutcome({ phase: "failed", opId: OP, error: "Project 'X' not found." }))
      .toEqual({ status: "error-internal", boqName: null, error: "Project 'X' not found." });
    expect(uploadOutcome({ phase: "lost", opId: OP, error: "The server stopped while running this." }).status)
      .toBe("error-internal");
  });

  it("names the uploaded file from the operation's context, so a reload still shows it", () => {
    expect(uploadedFileOf({ name: "Tower_A.xlsx", size: 2048 })).toEqual({ name: "Tower_A.xlsx", size: 2048 });
    expect(uploadedFileOf(undefined)).toBeNull();
    expect(uploadedFileOf({ name: "Tower_A.xlsx" })).toBeNull();
  });
});
