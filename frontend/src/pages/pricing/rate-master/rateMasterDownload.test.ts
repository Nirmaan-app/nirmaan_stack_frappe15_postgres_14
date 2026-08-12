import { describe, expect, it } from "vitest";

import { DOWNLOAD_COPY, downloadErrorMessage } from "./rateMasterDownload";

// SLICE 5. `downloadBase64` is deliberately NOT covered here: it builds a Blob and clicks an <a>,
// and this project runs vitest with environment "node" and no DOM on purpose (see frontend/CLAUDE.md).
// A helper that only touches the DOM is structurally untestable here; the browser cert is its gate.
// `downloadErrorMessage` is pure, and it is the half that actually decides what a user is told.

describe("downloadErrorMessage", () => {
  it("prefers _server_messages -- our own frappe.throw wording", () => {
    const err = {
      message: "Request failed",
      _server_messages: JSON.stringify([
        JSON.stringify({ message: "Unknown category 'nope' for Electrical." }),
      ]),
    };
    expect(downloadErrorMessage(err)).toBe("Unknown category 'nope' for Electrical.");
  });

  it("joins several server messages rather than dropping all but one", () => {
    const err = {
      _server_messages: JSON.stringify([
        JSON.stringify({ message: "First." }),
        JSON.stringify({ message: "Second." }),
      ]),
    };
    expect(downloadErrorMessage(err)).toBe("First. Second.");
  });

  it("accepts a plain-string server message entry (not every entry is nested JSON)", () => {
    const err = { _server_messages: JSON.stringify(["Plain text message."]) };
    expect(downloadErrorMessage(err)).toBe("Plain text message.");
  });

  it("falls back to `exception` with the class prefix stripped", () => {
    // THE REGRESSION THIS FILE EXISTS FOR: a stale web worker produced exactly this, and the panel
    // rendered "There was an error." The cause had to be dug out of the network tab by hand.
    const err = {
      exception:
        "frappe.exceptions.ValidationError: Failed to get method for command " +
        "nirmaan_stack.api.boq.rate_master.export_rate_master_csv",
    };
    expect(downloadErrorMessage(err)).toBe(
      "Failed to get method for command nirmaan_stack.api.boq.rate_master.export_rate_master_csv"
    );
  });

  it("strips a PermissionError prefix too -- the admin gate is the likeliest real failure", () => {
    const err = { exception: "frappe.exceptions.PermissionError: Not permitted." };
    expect(downloadErrorMessage(err)).toBe("Not permitted.");
  });

  it("uses `message` when there is nothing richer", () => {
    expect(downloadErrorMessage({ message: "Network request failed" })).toBe(
      "Network request failed"
    );
  });

  it("never returns an empty string, whatever it is handed", () => {
    for (const bad of [null, undefined, {}, { message: "" }, { message: "   " }, "nope", 42]) {
      expect(downloadErrorMessage(bad).trim().length).toBeGreaterThan(0);
    }
  });

  it("does not mask a real message when _server_messages is malformed", () => {
    // A broken envelope must fall THROUGH to the next source, never swallow the error.
    const err = { _server_messages: "{not json", exception: "frappe.exceptions.ValidationError: Real cause." };
    expect(downloadErrorMessage(err)).toBe("Real cause.");
  });
});

describe("DOWNLOAD_COPY", () => {
  it("groups by PURPOSE, not by file format", () => {
    // The failure this guards against is someone downloading the BACKUP, editing it, and finding
    // nothing reads it back. Neither group label may name a file extension.
    expect(DOWNLOAD_COPY.editGroup).toBe("Download to edit");
    expect(DOWNLOAD_COPY.backupGroup).toBe("Download a backup");
    for (const label of [DOWNLOAD_COPY.editGroup, DOWNLOAD_COPY.backupGroup]) {
      expect(label.toLowerCase()).not.toMatch(/csv|json|xlsx|file format/);
    }
  });

  it("tells the user the one rule for adding a row, naming the real column", () => {
    // "leave item_uid blank" is the whole contract of the upload's add-vs-edit branch, so the copy
    // must name the actual column the CSV carries -- not a prettified label.
    expect(DOWNLOAD_COPY.newRowHint).toContain("item_uid");
  });

  it("marks the backup as not-for-editing", () => {
    expect(DOWNLOAD_COPY.backupHint.toLowerCase()).toContain("not for editing");
  });
});
