import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  HISTORY_STATUSES,
  PROJECT_CUSTOM_ID_PREFIX,
  STORED_STATUS,
  cartRequestTypeOf,
  customItemKey,
  entryAddedSinceRequest,
  historyStatusOf,
  historyStatusesIn,
  isProjectCustomId,
  itemStatusOf,
  repositoryEntryKey,
  requestTypeOf,
  storedStatusesFor,
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

  it("submit writes rows through those constants, not literals", () => {
    expect(SUBMIT_PY).toContain("tds_status=STATUS_NEW_MAKE");
    expect(SUBMIT_PY).toContain("tds_status=STATUS_PENDING");
    expect(SUBMIT_PY).not.toMatch(/tds_status="(New|Pending)"/);
  });
});

describe("requestTypeOf", () => {
  it("a PCUS- id is Project Custom, whatever the status", () => {
    expect(requestTypeOf({ tds_item_id: "PCUS-000001", tds_status: "Pending" })).toBe("Project Custom");
    expect(requestTypeOf({ tds_item_id: "PCUS-000003", tds_status: "New" })).toBe("Project Custom");
    expect(requestTypeOf({ tds_item_id: "PCUS-000001", tds_status: "Approved" })).toBe("Project Custom");
  });

  it("status New with a TDS Item id is New Make", () => {
    expect(requestTypeOf({ tds_item_id: "TDS-ITEM-00012", tds_status: "New" })).toBe("New Make");
  });

  it("everything else is From Repository", () => {
    expect(requestTypeOf({ tds_item_id: "TDS-ITEM-00012", tds_status: "Pending" })).toBe("From Repository");
    expect(requestTypeOf({ tds_item_id: "TDS-ITEM-00012", tds_status: null })).toBe("From Repository");
    // A legacy New row with no TDS Item id never becomes New Make: there is no item to add a make to.
    expect(requestTypeOf({ tds_item_id: "", tds_status: "New" })).toBe("From Repository");
    expect(requestTypeOf({ tds_item_id: null, tds_status: "New" })).toBe("From Repository");
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
