import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  DATASHEET_CHOICE,
  HISTORY_STATUSES,
  HISTORY_STATUS_LABEL,
  PROJECT_CUSTOM_ID_PREFIX,
  STORED_STATUS,
  cartRequestTypeOf,
  customItemKey,
  datasheetFileName,
  entryAddedSinceRequest,
  historyStatusLabel,
  historyStatusOf,
  historyStatusesIn,
  isEditableRequest,
  isProjectCustomId,
  itemStatusOf,
  liveRowFor,
  rejectedRowFor,
  repositoryEntryKey,
  requestTypeOf,
  storedStatusesFor,
} from "./tdsRequestRules";
import {
  CLIENT_STATUS,
  CLIENT_STATUS_ACTION,
  HISTORY_TABS,
  clientStatusActionsFor,
  historyTabFilters,
  historyTabOf,
  isClientStatusMarkable,
} from "./tdsRequestRules";
import {
  PDF_DEFAULT_STATUSES,
  PDF_STATUSES,
  isPdfPreviewOnly,
  offersTickApprovedByAdmin,
  pdfPackagesFor,
  pdfPrintOrder,
  pdfSeedTicks,
  pdfStatusOf,
  toggleTick,
} from "./tdsRequestRules";

// The backend writes the stored values; this module only reads them. The PARITY block reads the
// Python that writes them, so a renamed status or prefix there fails here instead of silently
// mis-typing rows.
const pySource = (file: string) =>
  readFileSync(resolve(__dirname, "../../../nirmaan_stack/api/tds", file), "utf-8");
const SUBMIT_PY = pySource("submit.py");

const pyConstant = (name: string) => {
  const m = SUBMIT_PY.match(new RegExp(`^${name}\\s*=\\s*"([^"]*)"`, "m"));
  expect(m, `${name} not found in submit.py`).toBeTruthy();
  return m![1];
};

describe("parity with api/tds/submit.py", () => {
  it("the Project Custom id prefix matches", () => {
    expect(pyConstant("PROJECT_CUSTOM_ID_PREFIX")).toBe(PROJECT_CUSTOM_ID_PREFIX);
  });

  it("PCUS- ids are minted through that constant, not a literal", () => {
    expect(SUBMIT_PY).toMatch(/f"\{PROJECT_CUSTOM_ID_PREFIX\}\{highest:06d\}"/);
    expect(SUBMIT_PY).not.toMatch(/f"PCUS-/);
  });

  it("a Project Custom name is folded the same way: trimmed, ignoring case", () => {
    expect(SUBMIT_PY).toMatch(/return \(name or ""\)\.strip\(\)\.lower\(\)/);
    expect(customItemKey("  Facade LIGHT ", "Philips")).toBe(customItemKey("facade light", "Philips"));
  });

  it("the stored Pending and New Make statuses match", () => {
    expect(pyConstant("STATUS_PENDING")).toBe(STORED_STATUS.pending);
    expect(pyConstant("STATUS_NEW_MAKE")).toBe(STORED_STATUS.newMake);
  });

  it("the duplicate check counts every row but a Rejected one as live, as liveRowFor does", () => {
    const body = SUBMIT_PY.match(/def _refuse_duplicates\([\s\S]*?(?=\ndef )/);
    expect(body, "_refuse_duplicates not found in submit.py").toBeTruthy();
    expect(body![0]).toMatch(/row\.name == exclude or row\.tds_status == "Rejected" or _stored_key\(row\) not in seen/);
  });

  it("submit writes rows through those constants, not literals", () => {
    expect(SUBMIT_PY).toContain("tds_status=STATUS_NEW_MAKE");
    expect(SUBMIT_PY).toContain("tds_status=STATUS_PENDING");
    expect(SUBMIT_PY).not.toMatch(/tds_status="(New|Pending)"/);
  });
});

describe("parity with api/tds/approve.py", () => {
  const APPROVE_PY = pySource("approve.py");
  const approveConstant = (name: string) => {
    const m = APPROVE_PY.match(new RegExp(`^${name}\\s*=\\s*"([^"]*)"`, "m"));
    expect(m, `${name} not found in approve.py`).toBeTruthy();
    return m![1];
  };

  it("the datasheet choices match", () => {
    expect(approveConstant("CHOICE_REPOSITORY")).toBe(DATASHEET_CHOICE.repository);
    expect(approveConstant("CHOICE_REQUEST")).toBe(DATASHEET_CHOICE.request);
  });
});

describe("parity with api/tds/edit_request.py", () => {
  const EDIT_PY = pySource("edit_request.py");

  it("the server edits the same rows: New, or a Project Custom row still Pending", () => {
    const body = EDIT_PY.match(/def _is_waiting_request\(row\):[\s\S]*?(?=\n\n|$)/);
    expect(body, "_is_waiting_request not found in edit_request.py").toBeTruthy();
    expect(body![0]).toMatch(
      /row\.tds_status == STATUS_NEW_MAKE or \(\s*row\.tds_status == STATUS_PENDING and is_project_custom_id\(row\.tds_item_id\)\s*\)/
    );
  });
});

describe("parity with api/tds/status_label.py", () => {
  const LABEL_PY = pySource("status_label.py");
  const labelConstant = (name: string) => {
    const m = LABEL_PY.match(new RegExp(`^${name}\\s*=\\s*"([^"]*)"`, "m"));
    expect(m, `${name} not found in status_label.py`).toBeTruthy();
    return m![1];
  };

  it("the Handover print shows the same words as TDS History", () => {
    expect(labelConstant("APPROVED_LABEL")).toBe(HISTORY_STATUS_LABEL.Approved);
    expect(labelConstant("PENDING_LABEL")).toBe(HISTORY_STATUS_LABEL.Pending);
    expect(labelConstant("REJECTED_LABEL")).toBe(HISTORY_STATUS_LABEL.Rejected);
  });
});

describe("isEditableRequest", () => {
  it("a New row is a request, with or without a TDS Item id", () => {
    expect(isEditableRequest({ tds_item_id: "TDS-ITEM-00012", tds_status: "New" })).toBe(true);
    // A legacy New row with no TDS Item: the request dialog is where an Admin can fix it.
    expect(isEditableRequest({ tds_item_id: "", tds_status: "New" })).toBe(true);
  });

  it("a Project Custom row is a request while it is Pending", () => {
    expect(isEditableRequest({ tds_item_id: "PCUS-000001", tds_status: "Pending" })).toBe(true);
    expect(isEditableRequest({ tds_item_id: "PCUS-000001", tds_status: "Approved" })).toBe(false);
    expect(isEditableRequest({ tds_item_id: "PCUS-000001", tds_status: "Rejected" })).toBe(false);
  });

  it("a From Repository row is not: it keeps the Edit TDS Item dialog", () => {
    expect(isEditableRequest({ tds_item_id: "TDS-ITEM-00012", tds_status: "Pending" })).toBe(false);
    expect(isEditableRequest({ tds_item_id: "TDS-ITEM-00012", tds_status: null })).toBe(false);
  });
});

describe("datasheetFileName", () => {
  it("reads the file name from each stored datasheet URL shape", () => {
    expect(
      datasheetFileName(
        "/api/method/frappe_gcp_attachment.controller.generate_file?key=abc%2Fy.pdf&file_name=Y%20Strainer%20PN16.pdf"
      )
    ).toBe("Y Strainer PN16.pdf");
    expect(datasheetFileName("/private/files/zoloto_2026.pdf")).toBe("zoloto_2026.pdf");
    expect(datasheetFileName("/files/a%20b.pdf")).toBe("a b.pdf");
  });

  it("is blank for no datasheet", () => {
    expect(datasheetFileName(undefined)).toBe("");
    expect(datasheetFileName("")).toBe("");
  });
});

describe("requestTypeOf", () => {
  it("a PCUS- id is Project Custom, whatever the status", () => {
    expect(requestTypeOf({ tds_item_id: "PCUS-000001", tds_status: "Pending" })).toBe("Project Custom");
    expect(requestTypeOf({ tds_item_id: "PCUS-000003", tds_status: "New" })).toBe("Project Custom");
    expect(requestTypeOf({ tds_item_id: "PCUS-000001", tds_status: "Approved" })).toBe("Project Custom");
  });

  it("status New is New Make", () => {
    expect(requestTypeOf({ tds_item_id: "TDS-ITEM-00012", tds_status: "New" })).toBe("New Make");
  });

  it("a legacy New row with no TDS Item id is New Make, the path the server approves it on", () => {
    // The server refuses it until it is edited into a New Make or a Project Custom item; it is never a pick.
    expect(requestTypeOf({ tds_item_id: "", tds_status: "New" })).toBe("New Make");
    expect(requestTypeOf({ tds_item_id: null, tds_status: "New" })).toBe("New Make");
  });

  it("everything else is From Repository", () => {
    expect(requestTypeOf({ tds_item_id: "TDS-ITEM-00012", tds_status: "Pending" })).toBe("From Repository");
    expect(requestTypeOf({ tds_item_id: "TDS-ITEM-00012", tds_status: null })).toBe("From Repository");
  });

  it("only the prefix counts, not a PCUS substring", () => {
    expect(requestTypeOf({ tds_item_id: "XPCUS-1", tds_status: "Pending" })).toBe("From Repository");
  });
});

describe("isProjectCustomId", () => {
  it("is true only for the PCUS- prefix", () => {
    expect(isProjectCustomId("PCUS-000001")).toBe(true);
    expect(isProjectCustomId("TDS-ITEM-00012")).toBe(false);
    expect(isProjectCustomId("XPCUS-1")).toBe(false);
    expect(isProjectCustomId(null)).toBe(false);
    expect(isProjectCustomId(undefined)).toBe(false);
  });
});

describe("cartRequestTypeOf", () => {
  it("a picked row is From Repository", () => {
    expect(cartRequestTypeOf({})).toBe("From Repository");
    expect(cartRequestTypeOf({ is_new_request: false })).toBe("From Repository");
  });

  it("a Request New row is New Make, unless it is Project Custom", () => {
    expect(cartRequestTypeOf({ is_new_request: true })).toBe("New Make");
    expect(cartRequestTypeOf({ is_new_request: true, is_project_custom: true })).toBe("Project Custom");
  });
});

describe("customItemKey", () => {
  it("keys on the folded name + the exact make", () => {
    expect(customItemKey("Facade Light", "Philips")).not.toBe(customItemKey("Facade Light", "Wipro"));
    expect(customItemKey("Facade Light", "Philips")).not.toBe(customItemKey("Facade Lights", "Philips"));
    expect(customItemKey("Facade Light", "Philips")).not.toBe(customItemKey("Facade Light", "philips"));
    // The server strips the make it is sent.
    expect(customItemKey("Facade Light", " Philips ")).toBe(customItemKey("Facade Light", "Philips"));
  });
});

describe("rejectedRowFor", () => {
  const rows = [
    { name: "r-pick", tds_item_id: "TDS-ITEM-1", tds_item_name: "Gate Valve", tds_make: "MakeA", tds_status: "Rejected" },
    { name: "r-live", tds_item_id: "TDS-ITEM-1", tds_item_name: "Gate Valve", tds_make: "MakeB", tds_status: "Approved" },
    { name: "r-custom", tds_item_id: "PCUS-000002", tds_item_name: "FACADE light", tds_make: "Philips", tds_status: "Rejected" },
    { name: "r-name-clash", tds_item_id: "TDS-ITEM-2", tds_item_name: "Cove Strip", tds_make: "Wipro", tds_status: "Rejected" },
  ];

  it("a pick or New Make matches its TDS Item + make", () => {
    expect(rejectedRowFor(rows, { tds_item_id: "TDS-ITEM-1", tds_item_name: "Gate Valve", make: "MakeA" })?.name).toBe("r-pick");
    expect(
      rejectedRowFor(rows, { tds_item_id: "TDS-ITEM-1", tds_item_name: "Gate Valve", make: "MakeA", is_new_request: true })?.name
    ).toBe("r-pick");
  });

  it("a Project Custom row matches its name ignoring case + make, whatever id the rejected row holds", () => {
    const custom = { tds_item_id: "", tds_item_name: " Facade Light ", make: "Philips", is_new_request: true, is_project_custom: true };
    expect(rejectedRowFor(rows, custom)?.name).toBe("r-custom");
    expect(rejectedRowFor(rows, { ...custom, make: "Wipro" })).toBeUndefined();
  });

  it("a Project Custom row never matches a TDS Item row of the same name", () => {
    expect(
      rejectedRowFor(rows, { tds_item_id: "", tds_item_name: "Cove Strip", make: "Wipro", is_project_custom: true })
    ).toBeUndefined();
  });

  it("only a Rejected row is replaced", () => {
    expect(rejectedRowFor(rows, { tds_item_id: "TDS-ITEM-1", tds_item_name: "Gate Valve", make: "MakeB" })).toBeUndefined();
    expect(rejectedRowFor(undefined, { tds_item_id: "TDS-ITEM-1", tds_item_name: "Gate Valve", make: "MakeA" })).toBeUndefined();
  });
});

describe("liveRowFor", () => {
  const row = (name: string, tds_status: string | null, tds_make = "MakeA", tds_item_id = "TDS-ITEM-1") => ({
    name,
    tds_item_id,
    tds_item_name: "Gate Valve",
    tds_make,
    tds_status,
  });
  const pick = { tds_item_id: "TDS-ITEM-1", tds_item_name: "Gate Valve", make: "MakeA" };

  it("every waiting or approved row is live, New and a legacy blank included", () => {
    for (const status of ["Pending", "New", "Approved", null]) {
      expect(liveRowFor([row("r", status)], pick)?.name, String(status)).toBe("r");
    }
  });

  it("a Rejected row is not live: it is what a resubmit replaces", () => {
    expect(liveRowFor([row("r", "Rejected")], pick)).toBeUndefined();
  });

  it("matches the same TDS Item + make only", () => {
    expect(liveRowFor([row("r", "Pending", "MakeB"), row("s", "Pending", "MakeA", "TDS-ITEM-2")], pick)).toBeUndefined();
    expect(liveRowFor(undefined, pick)).toBeUndefined();
  });

  it("a Project Custom row matches its name ignoring case + make", () => {
    const custom = { tds_item_id: "", tds_item_name: " gate VALVE", make: "MakeA", is_project_custom: true };
    expect(liveRowFor([row("r", "Pending", "MakeA", "PCUS-000003")], custom)?.name).toBe("r");
    expect(liveRowFor([row("r", "Pending")], custom)).toBeUndefined();
  });
});

describe("itemStatusOf", () => {
  const verified = { status: "Verified" };
  const notVerified = { status: "Not Verified" };

  it("Project Custom is always --, even if an entry matches", () => {
    const row = { tds_item_id: "PCUS-000001", tds_status: "Pending" };
    expect(itemStatusOf(row, undefined)).toBe("--");
    expect(itemStatusOf(row, verified)).toBe("--");
  });

  it("New Make shows the entry's status, or Not Verified with no entry", () => {
    const row = { tds_item_id: "TDS-ITEM-00012", tds_status: "New" };
    expect(itemStatusOf(row, undefined)).toBe("Not Verified");
    expect(itemStatusOf(row, verified)).toBe("Verified");
    expect(itemStatusOf(row, notVerified)).toBe("Not Verified");
  });

  it("From Repository shows the entry's status, or -- with no entry", () => {
    const row = { tds_item_id: "TDS-ITEM-00012", tds_status: "Pending" };
    expect(itemStatusOf(row, undefined)).toBe("--");
    expect(itemStatusOf(row, verified)).toBe("Verified");
    expect(itemStatusOf(row, notVerified)).toBe("Not Verified");
  });

  it("an entry with a blank status reads Not Verified (the field's default)", () => {
    const row = { tds_item_id: "TDS-ITEM-00012", tds_status: "Pending" };
    expect(itemStatusOf(row, { status: "" })).toBe("Not Verified");
    expect(itemStatusOf(row, {})).toBe("Not Verified");
  });
});

describe("entryAddedSinceRequest", () => {
  it("is true only for a New Make whose entry exists", () => {
    const newMake = { tds_item_id: "TDS-ITEM-00012", tds_status: "New" };
    expect(entryAddedSinceRequest(newMake, { status: "Verified" })).toBe(true);
    expect(entryAddedSinceRequest(newMake, undefined)).toBe(false);
    expect(entryAddedSinceRequest({ tds_item_id: "TDS-ITEM-00012", tds_status: "Pending" }, { status: "Verified" })).toBe(false);
    expect(entryAddedSinceRequest({ tds_item_id: "PCUS-000001", tds_status: "New" }, { status: "Verified" })).toBe(false);
  });
});

describe("repositoryEntryKey", () => {
  it("keys on TDS Item + make, both exact, as the backend looks the entry up", () => {
    expect(repositoryEntryKey("TDS-ITEM-1", "Polycab")).toBe(repositoryEntryKey("TDS-ITEM-1", "Polycab"));
    expect(repositoryEntryKey("TDS-ITEM-1", "Polycab")).not.toBe(repositoryEntryKey("TDS-ITEM-1", "polycab"));
    expect(repositoryEntryKey("TDS-ITEM-1", "Polycab")).not.toBe(repositoryEntryKey("TDS-ITEM-1", " Polycab"));
    expect(repositoryEntryKey("TDS-ITEM-1", "Polycab")).not.toBe(repositoryEntryKey("TDS-ITEM-2", "Polycab"));
    expect(repositoryEntryKey(null, undefined)).toBe("|");
  });
});

describe("historyStatusOf", () => {
  it("New reads Pending", () => {
    expect(historyStatusOf("New")).toBe("Pending");
  });

  it("Pending, Approved and Rejected pass through", () => {
    expect(historyStatusOf("Pending")).toBe("Pending");
    expect(historyStatusOf("Approved")).toBe("Approved");
    expect(historyStatusOf("Rejected")).toBe("Rejected");
  });

  it("a blank status reads Pending", () => {
    expect(historyStatusOf(null)).toBe("Pending");
    expect(historyStatusOf(undefined)).toBe("Pending");
    expect(historyStatusOf("")).toBe("Pending");
  });

  it("offers exactly three statuses", () => {
    expect(HISTORY_STATUSES).toEqual(["Pending", "Approved", "Rejected"]);
  });
});

describe("historyStatusLabel", () => {
  it("an Admin-approved row reads Approved by Admin", () => {
    expect(historyStatusLabel("Approved")).toBe("Approved by Admin");
  });

  it("Pending and Rejected read as themselves, and New reads Pending", () => {
    expect(historyStatusLabel("Pending")).toBe("Pending");
    expect(historyStatusLabel("New")).toBe("Pending");
    expect(historyStatusLabel("Rejected")).toBe("Rejected");
  });

  it("a blank status reads Pending", () => {
    expect(historyStatusLabel(null)).toBe("Pending");
    expect(historyStatusLabel("")).toBe("Pending");
  });
});

describe("storedStatusesFor", () => {
  it("Pending also matches New", () => {
    expect(storedStatusesFor(["Pending"])).toEqual(["Pending", "New"]);
  });

  it("Approved and Rejected match themselves", () => {
    expect(storedStatusesFor(["Approved", "Rejected"])).toEqual(["Approved", "Rejected"]);
  });

  it("every stored value maps back to the shown status it came from", () => {
    for (const shown of HISTORY_STATUSES) {
      for (const stored of storedStatusesFor([shown])) {
        expect(historyStatusOf(stored)).toBe(shown);
      }
    }
  });

  it("nothing selected stays nothing", () => {
    expect(storedStatusesFor([])).toEqual([]);
  });
});

describe("historyStatusesIn", () => {
  it("reads a stored-status filter back as the shown statuses, once each", () => {
    expect(historyStatusesIn(["Pending", "New"])).toEqual(["Pending"]);
    expect(historyStatusesIn(["New"])).toEqual(["Pending"]);
    expect(historyStatusesIn(["Approved", "Pending", "New"])).toEqual(["Approved", "Pending"]);
  });

  it("is empty for no filter or a non-array filter value", () => {
    expect(historyStatusesIn(undefined)).toEqual([]);
    expect(historyStatusesIn([])).toEqual([]);
    expect(historyStatusesIn("Pending")).toEqual([]);
  });

  it("round-trips with storedStatusesFor", () => {
    const shown = ["Pending", "Rejected"];
    expect(historyStatusesIn(storedStatusesFor(shown))).toEqual(shown);
  });
});

// ── Client Status (#1385, ADR-0025 Amendment B) ─────────────────────────────────────────────────

describe("parity with api/tds/client_status.py", () => {
  const CLIENT_PY = pySource("client_status.py");
  const clientConstant = (name: string) => {
    const m = CLIENT_PY.match(new RegExp(`^${name}\\s*=\\s*"([^"]*)"`, "m"));
    expect(m, `${name} not found in client_status.py`).toBeTruthy();
    return m![1];
  };

  it("the stored Client Status values match", () => {
    expect(clientConstant("CLIENT_STATUS_APPROVED")).toBe(CLIENT_STATUS.approved);
    expect(clientConstant("CLIENT_STATUS_REJECTED")).toBe(CLIENT_STATUS.rejected);
  });

  it("the endpoint's actions match", () => {
    expect(clientConstant("ACTION_MARK_APPROVED")).toBe(CLIENT_STATUS_ACTION.markApproved);
    expect(clientConstant("ACTION_MARK_REJECTED")).toBe(CLIENT_STATUS_ACTION.markRejected);
    expect(clientConstant("ACTION_CLEAR")).toBe(CLIENT_STATUS_ACTION.clear);
  });

  it("only an Admin-approved row takes one, as isClientStatusMarkable says", () => {
    expect(pyConstant("STATUS_APPROVED")).toBe(STORED_STATUS.approved);
    expect(CLIENT_PY).toMatch(/if row\.tds_status != STATUS_APPROVED:/);
  });
});

describe("historyTabOf", () => {
  it("a row the client has not answered stays in TDS History, whatever its tds_status", () => {
    for (const tds_status of ["Pending", "New", "Approved", "Rejected", "", null]) {
      expect(historyTabOf({ tds_status, client_status: "" })).toBe("history");
      expect(historyTabOf({ tds_status, client_status: null })).toBe("history");
      expect(historyTabOf({ tds_status })).toBe("history");
    }
  });

  it("a client-answered row sits in that answer's tab", () => {
    expect(historyTabOf({ tds_status: "Approved", client_status: "Approved by Client" })).toBe("approvedByClient");
    expect(historyTabOf({ tds_status: "Approved", client_status: "Rejected by Client" })).toBe("rejectedByClient");
  });

  it("the tabs read TDS History, Approved by Client, Rejected by Client, in that order", () => {
    expect(HISTORY_TABS.map(t => t.label)).toEqual(["TDS History", "Approved by Client", "Rejected by Client"]);
    expect(HISTORY_TABS.map(t => t.value)).toEqual(["history", "approvedByClient", "rejectedByClient"]);
  });
});

describe("historyTabFilters", () => {
  it("TDS History asks the server for rows with no Client Status (NULL or blank)", () => {
    expect(historyTabFilters("history")).toEqual([["client_status", "is", "not set"]]);
  });

  it("each client tab asks for exactly its answer", () => {
    expect(historyTabFilters("approvedByClient")).toEqual([["client_status", "=", "Approved by Client"]]);
    expect(historyTabFilters("rejectedByClient")).toEqual([["client_status", "=", "Rejected by Client"]]);
  });
});

describe("isClientStatusMarkable", () => {
  it("only an Admin-approved row gets a tick box", () => {
    expect(isClientStatusMarkable({ tds_status: "Approved" })).toBe(true);
    for (const tds_status of ["Pending", "New", "Rejected", "", null, undefined]) {
      expect(isClientStatusMarkable({ tds_status })).toBe(false);
    }
  });

  it("an answered row stays markable, so it can be switched", () => {
    expect(isClientStatusMarkable({ tds_status: "Approved", client_status: "Rejected by Client" })).toBe(true);
  });
});

describe("clientStatusActionsFor", () => {
  const marker = { canMark: true, canClear: false };

  it("TDS History offers both marks to an Admin or PMO Executive", () => {
    expect(clientStatusActionsFor("history", marker)).toEqual(["mark_approved", "mark_rejected"]);
    expect(clientStatusActionsFor("history", { canMark: true, canClear: true })).toEqual([
      "mark_approved",
      "mark_rejected",
    ]);
  });

  it("anyone else gets no marking action", () => {
    for (const tab of HISTORY_TABS) {
      expect(clientStatusActionsFor(tab.value, { canMark: false, canClear: false })).toEqual([]);
    }
  });
});

// ── Download TDS PDF dialog (#1388) ─────────────────────────────────────────────────────────────

describe("pdfStatusOf", () => {
  it("puts a client-approved row under Approved by Client, never Approved by Admin", () => {
    expect(pdfStatusOf({ tds_status: "Approved", client_status: "Approved by Client" })).toBe("Approved by Client");
  });

  it("puts an Admin-approved row the client hasn't answered under Approved by Admin", () => {
    expect(pdfStatusOf({ tds_status: "Approved", client_status: "" })).toBe("Approved by Admin");
    expect(pdfStatusOf({ tds_status: "Approved", client_status: null })).toBe("Approved by Admin");
    expect(pdfStatusOf({ tds_status: "Approved" })).toBe("Approved by Admin");
  });

  it("never offers a Rejected by Client row", () => {
    expect(pdfStatusOf({ tds_status: "Approved", client_status: "Rejected by Client" })).toBeNull();
  });

  it("puts Pending and New Make rows under Pending", () => {
    expect(pdfStatusOf({ tds_status: "Pending" })).toBe("Pending");
    expect(pdfStatusOf({ tds_status: "New" })).toBe("Pending");
  });

  it("never offers an Admin-rejected row", () => {
    expect(pdfStatusOf({ tds_status: "Rejected" })).toBeNull();
  });
});

describe("toggleTick", () => {
  it("a tick goes to the end, so its number is the order it was ticked in", () => {
    expect(toggleTick([], "Pending")).toEqual(["Pending"]);
    expect(toggleTick(["Pending"], "Approved by Client")).toEqual(["Pending", "Approved by Client"]);
  });

  it("unticking removes it and the ticks after it move up one", () => {
    expect(toggleTick(["HVAC", "Plumbing", "Fire Fighting"], "HVAC")).toEqual(["Plumbing", "Fire Fighting"]);
  });

  it("re-ticking puts it last, not back where it was", () => {
    expect(toggleTick(toggleTick(["A", "B", "C"], "A"), "A")).toEqual(["B", "C", "A"]);
  });

  it("leaves the list it was given untouched", () => {
    const ticks = ["A", "B"];
    toggleTick(ticks, "A");
    toggleTick(ticks, "C");
    expect(ticks).toEqual(["A", "B"]);
  });
});

describe("pdfPrintOrder", () => {
  const row = (name: string, tds_work_package: string, status: string, client_status = "", tds_category = "Cat", tds_item_name = name) => ({
    name,
    tds_work_package,
    tds_category,
    tds_item_name,
    tds_status: status,
    client_status,
  });
  const ROWS = [
    row("plumb-admin", "Plumbing", "Approved"),
    row("elec-client", "Electrical Work", "Approved", "Approved by Client"),
    row("hvac-pending", "HVAC", "Pending"),
    row("plumb-client", "Plumbing", "Approved", "Approved by Client"),
    row("elec-admin", "Electrical Work", "Approved"),
    row("hvac-new", "HVAC", "New"),
    row("elec-rejected-by-client", "Electrical Work", "Approved", "Rejected by Client"),
    row("plumb-rejected", "Plumbing", "Rejected"),
  ];
  const shape = (groups: ReturnType<typeof pdfPrintOrder>) =>
    groups.map(g => [g.status, g.packages.map(p => [p.package, p.rows.map(r => r.name)])]);

  it("prints statuses in tick order, each with its packages A to Z when none is ticked", () => {
    expect(shape(pdfPrintOrder(ROWS, ["Pending", "Approved by Client"], []))).toEqual([
      ["Pending", [["HVAC", ["hvac-new", "hvac-pending"]]]],
      ["Approved by Client", [["Electrical Work", ["elec-client"]], ["Plumbing", ["plumb-client"]]]],
    ]);
  });

  it("prints only the ticked packages, in the order they were ticked", () => {
    expect(shape(pdfPrintOrder(ROWS, ["Approved by Client", "Approved by Admin"], ["Plumbing", "Electrical Work"]))).toEqual([
      ["Approved by Client", [["Plumbing", ["plumb-client"]], ["Electrical Work", ["elec-client"]]]],
      ["Approved by Admin", [["Plumbing", ["plumb-admin"]], ["Electrical Work", ["elec-admin"]]]],
    ]);
  });

  it("Approved by Admin holds no client-answered row, and Rejected by Client never prints", () => {
    const names = pdfPrintOrder(ROWS, ["Approved by Admin"], [])
      .flatMap(g => g.packages.flatMap(p => p.rows.map(r => r.name)));
    expect(names.sort()).toEqual(["elec-admin", "plumb-admin"]);
  });

  it("prints every offered row once with all three ticked, and no row twice", () => {
    const names = pdfPrintOrder(ROWS, ["Approved by Admin", "Pending", "Approved by Client"], [])
      .flatMap(g => g.packages.flatMap(p => p.rows.map(r => r.name)));
    expect(new Set(names).size).toBe(names.length);
    expect(names.sort()).toEqual(
      ["elec-admin", "elec-client", "hvac-new", "hvac-pending", "plumb-admin", "plumb-client"]
    );
  });

  it("a status ticked twice prints once", () => {
    expect(pdfPrintOrder(ROWS, ["Pending", "Pending"], [])).toHaveLength(1);
  });

  it("keeps a ticked status with nothing in the ticked packages, so the summary can say so", () => {
    expect(shape(pdfPrintOrder(ROWS, ["Pending", "Approved by Client"], ["Plumbing"]))).toEqual([
      ["Pending", []],
      ["Approved by Client", [["Plumbing", ["plumb-client"]]]],
    ]);
  });

  it("sorts a package's rows by category, then item name, ignoring case", () => {
    const rows = [
      row("3", "P", "Pending", "", "valves", "Gate Valve"),
      row("1", "P", "Pending", "", "Pipes", "PPR Pipe"),
      row("2", "P", "Pending", "", "pipes", "cPVC Pipe"),
    ];
    expect(pdfPrintOrder(rows, ["Pending"], [])[0].packages[0].rows.map(r => r.name)).toEqual(["2", "1", "3"]);
  });

  it("a row with no work package prints under Unknown", () => {
    expect(shape(pdfPrintOrder([row("x", "", "Pending")], ["Pending"], []))).toEqual([
      ["Pending", [["Unknown", ["x"]]]],
    ]);
  });

  it("nothing ticked prints nothing", () => {
    expect(pdfPrintOrder(ROWS, [], [])).toEqual([]);
  });
});

describe("pdfPackagesFor", () => {
  const ROWS = [
    { name: "1", tds_work_package: "Plumbing", tds_status: "Approved", client_status: "Approved by Client" },
    { name: "2", tds_work_package: "HVAC", tds_status: "Pending" },
    { name: "3", tds_work_package: "Electrical Work", tds_status: "Approved", client_status: "Approved by Client" },
    { name: "4", tds_work_package: "Fire Fighting", tds_status: "Approved", client_status: "Rejected by Client" },
    { name: "5", tds_work_package: "Plumbing", tds_status: "Approved" },
  ];

  it("offers the packages the ticked statuses have, A to Z, once each", () => {
    expect(pdfPackagesFor(ROWS, ["Approved by Client"])).toEqual(["Electrical Work", "Plumbing"]);
    expect(pdfPackagesFor(ROWS, ["Pending", "Approved by Admin", "Approved by Client"])).toEqual([
      "Electrical Work",
      "HVAC",
      "Plumbing",
    ]);
  });

  it("never offers a package that only a Rejected by Client row has", () => {
    expect(pdfPackagesFor(ROWS, ["Approved by Client", "Approved by Admin", "Pending"])).not.toContain("Fire Fighting");
  });

  it("offers none until a status is ticked", () => {
    expect(pdfPackagesFor(ROWS, [])).toEqual([]);
  });
});

describe("PDF_DEFAULT_STATUSES", () => {
  it("the TDS page opens with only Approved by Client ticked", () => {
    expect(PDF_DEFAULT_STATUSES.tdsPage).toEqual(["Approved by Client"]);
  });

  it("Handover opens with both Approved choices ticked, client first", () => {
    expect(PDF_DEFAULT_STATUSES.handover).toEqual(["Approved by Client", "Approved by Admin"]);
  });

  it("the dialog offers the three statuses in this order", () => {
    expect(PDF_STATUSES).toEqual(["Approved by Client", "Approved by Admin", "Pending"]);
  });

  it("its Approved by Admin reads as TDS History's label for an Admin-approved row", () => {
    expect(historyStatusLabel("Approved")).toBe("Approved by Admin");
  });
});

describe("pdfSeedTicks", () => {
  const ROWS = [
    { name: "client", tds_status: "Approved", client_status: "Approved by Client" },
    { name: "admin", tds_status: "Approved", client_status: "" },
    { name: "pending", tds_status: "Pending" },
    { name: "rejected-by-client", tds_status: "Approved", client_status: "Rejected by Client" },
    { name: "rejected", tds_status: "Rejected" },
  ];

  it("with nothing saved (the TDS page), ticks every row the dialog offers", () => {
    expect(pdfSeedTicks(ROWS, undefined)).toEqual(new Set(["client", "admin", "pending"]));
  });

  it("Handover keeps a saved tick on an Admin-approved or client-approved row", () => {
    expect(pdfSeedTicks(ROWS, ["admin", "client"])).toEqual(new Set(["admin", "client"]));
  });

  it("Handover drops a saved tick on a row the client later rejected", () => {
    expect(pdfSeedTicks(ROWS, ["admin", "rejected-by-client"])).toEqual(new Set(["admin"]));
  });

  it("drops a saved tick on an Admin-rejected row or a row no longer listed", () => {
    expect(pdfSeedTicks(ROWS, ["rejected", "gone", "client"])).toEqual(new Set(["client"]));
  });

  it("an empty saved list ticks nothing", () => {
    expect(pdfSeedTicks(ROWS, [])).toEqual(new Set());
  });
});

describe("isPdfPreviewOnly", () => {
  it("a non-Admin with Pending ticked may only preview, wherever Pending sits in the order", () => {
    expect(isPdfPreviewOnly(["Pending"], false)).toBe(true);
    expect(isPdfPreviewOnly(["Approved by Client", "Pending"], false)).toBe(true);
  });

  it("a non-Admin without Pending ticked may download", () => {
    expect(isPdfPreviewOnly(["Approved by Client", "Approved by Admin"], false)).toBe(false);
    expect(isPdfPreviewOnly([], false)).toBe(false);
  });

  it("an Admin may always download", () => {
    expect(isPdfPreviewOnly(["Pending", "Approved by Admin"], true)).toBe(false);
  });
});

describe("offersTickApprovedByAdmin", () => {
  const ADMIN_ONLY = [
    { name: "a", tds_status: "Approved" },
    { name: "p", tds_status: "Pending" },
  ];

  it("offers it when only Approved by Client is ticked and the client hasn't approved anything", () => {
    expect(offersTickApprovedByAdmin(ADMIN_ONLY, ["Approved by Client"])).toBe(true);
  });

  it("does not offer it once Approved by Admin is ticked", () => {
    expect(offersTickApprovedByAdmin(ADMIN_ONLY, ["Approved by Client", "Approved by Admin"])).toBe(false);
  });

  it("does not offer it when there are client-approved rows", () => {
    const rows = [...ADMIN_ONLY, { name: "c", tds_status: "Approved", client_status: "Approved by Client" }];
    expect(offersTickApprovedByAdmin(rows, ["Approved by Client"])).toBe(false);
  });

  it("does not offer it when no row is Approved by Admin either", () => {
    expect(offersTickApprovedByAdmin([{ name: "p", tds_status: "Pending" }], ["Approved by Client"])).toBe(false);
  });

  it("does not offer it when another ticked status has rows to print", () => {
    expect(offersTickApprovedByAdmin(ADMIN_ONLY, ["Approved by Client", "Pending"])).toBe(false);
  });
});
