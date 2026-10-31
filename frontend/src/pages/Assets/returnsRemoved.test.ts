/**
 * Asset returns were REMOVED (owner, 2026-10-26; commit "feat(assets): remove returns").
 *
 * What went, and why: the holder's Return button and its dialog, the "Returned · waiting for approval" label,
 * the Assets page's Return Request sub-tab and its counts, the summary card's Returns badge, and the
 * "Return Requested" / "Return Rejected" history events. An asset now comes back only through Unassign
 * (Admin / HR), so a return that waited for an approval nobody could give is gone with it.
 *
 * These tests fail at once if any of that comes back, and if something that must STAY is taken out with it:
 * Unassign's "Returned – no longer needed" reason, the other sub-tabs, the Received line, the audit notes.
 * Backend twin: nirmaan_stack/api/assets/test_returns_removed.py.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { auditHistorySummary } from "@/utils/assetAudit";
import { describeHistory } from "@/utils/assetHistory";
import { UNASSIGN_REASONS } from "@/utils/assetUnassign";
import { assetListParams, assetListSyncKey } from "./utils/assetListLinks";

const SRC = resolve(__dirname, "../..");
const read = (path: string) => readFileSync(resolve(SRC, path), "utf-8");
const WHY = "asset returns were removed (owner, 2026-10-26) -- see returnsRemoved.test.ts";

/** Every .ts / .tsx file under src, except tests (this file names what it forbids). */
function sourceFiles(dir = SRC): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("returns stay removed", () => {
  it("has no Return Request list or its data hook", () => {
    expect(existsSync(resolve(SRC, "pages/Assets/components/ReturnRequestsList.tsx")), WHY).toBe(false);
    expect(existsSync(resolve(SRC, "pages/Assets/hooks/useReturnRequests.ts")), WHY).toBe(false);
  });

  // Reads every source file (~3 s in the container): a longer limit, so a busy machine can't fail it by timing out.
  it("calls no return endpoint anywhere in the app", { timeout: 30_000 }, () => {
    const callers = sourceFiles().filter((file) => readFileSync(file, "utf-8").includes("api.assets.returns"));
    expect(callers.map((file) => file.slice(SRC.length + 1)), WHY).toEqual([]);
  });

  it("has no Return Request sub-tab on the Assets page", () => {
    const page = read("pages/Assets/AssetsPage.tsx");
    expect(page, WHY).not.toMatch(/Return Request/);
    expect(page, WHY).not.toMatch(/'returns'/);
    expect(page, WHY).not.toMatch(/ReturnRequests/);
  });

  it("has no Returns badge on the summary card", () => {
    const card = read("pages/Assets/components/AssetsSummaryCard.tsx");
    expect(card, WHY).not.toMatch(/useReturnRequests|view="returns"|Returns?['"`]/);
  });

  it("has no Return button, dialog or 'waiting for approval' label on the holder's profile", () => {
    const tab = read("pages/users/components/UserAssetsTab.tsx");
    expect(tab, WHY).not.toMatch(/canReturn|onReturn|returnBlockedByAudit|requestReturn|returningAssignment/);
    expect(tab, WHY).not.toMatch(/waiting for approval/);
    expect(tab, WHY).not.toMatch(/Yes, I returned it/);
  });

  it("neither fetches nor caches the return fields", () => {
    const constants = read("pages/Assets/assets.constants.ts");
    expect(constants, WHY).not.toMatch(/'returned'|'returned_on'|RETURN_REQUESTS|returnRequestAssets/);
    expect(read("pages/Assets/hooks/useAssetDataRefresh.ts"), WHY).not.toMatch(/RETURN_REQUESTS/);
    expect(read("hooks/useUserAssignments.ts"), WHY).not.toMatch(/returned/);
  });

  it("has no 'returns' list link (the summary card can't open the removed tab)", () => {
    expect(read("pages/Assets/utils/assetListLinks.ts"), WHY).not.toMatch(/'returns'|returns:|return_requests/);
  });

  it("shows no return events in the history: no label, filter option, colour or Returns chip", () => {
    expect(read("utils/assetHistory.ts"), WHY).not.toMatch(/Return Requested|Return Rejected|"return"/);
    expect(read("pages/Assets/components/AssetHistoryList.tsx"), WHY).not.toMatch(/Return Requested|Return Rejected/);
    expect(read("pages/Assets/components/AssetHistoryCard.tsx"), WHY).not.toMatch(/'return'|Returns/);
  });

  it("gives an old return row no special wording (the events no longer exist)", () => {
    const [entry] = describeHistory(
      [{ name: "a", idx: 1, event: "Return Requested", assigned_to: "x@y", done_by: "x@y", done_on: "2026-10-14 10:00:00" }],
      (id) => id ?? ""
    );
    expect(entry.title, WHY).toBe("Return Requested");
    expect(entry.title, WHY).not.toMatch(/waiting for approval/);
  });

  it("no longer explains an audit as 'opened when the return was rejected'", () => {
    expect(read("utils/assetAudit.ts"), WHY).not.toMatch(/return rejected|return was rejected/);
    expect(auditHistorySummary("Audit Requested", "11/2026 · return rejected")?.line, WHY).not.toMatch(
      /return was rejected/
    );
  });
});

describe("what stays when returns went", () => {
  const KEPT = "kept on purpose when returns were removed (owner, 2026-10-26) -- see returnsRemoved.test.ts";

  it("keeps 'Returned – no longer needed' as an Unassign reason (how a hand-back is recorded now)", () => {
    expect(UNASSIGN_REASONS, KEPT).toContain("Returned – no longer needed");
  });

  it("keeps the other Assets sub-tabs, in order", () => {
    const page = read("pages/Assets/AssetsPage.tsx");
    // 'lost' (Lost/Damaged) was added after returns went (owner, 2026-10-31).
    expect(page, KEPT).toMatch(/SUB_TABS: readonly AssetSubTab\[\] = \['all', 'assigned', 'unassigned', 'lost', 'pending', 'audit'\]/);
    for (const label of ["'All'", "'Assigned'", "'Unassigned'", "'Pending Declaration'", "'Asset Audit'"]) {
      expect(page, `${KEPT}: sub-tab ${label}`).toContain(`label: ${label}`);
    }
  });

  it("keeps the summary card's list links", () => {
    for (const view of ["all", "assigned", "unassigned", "pending"] as const) {
      expect(assetListSyncKey("IT", view), KEPT).not.toBeNull();
      expect(assetListParams({ type: "IT", view }).tab, KEPT).toBe("it");
    }
  });

  it("keeps the holder's Received line, Sign, Submit audit and Unassign", () => {
    const tab = read("pages/users/components/UserAssetsTab.tsx");
    for (const kept of ["Received", "onSign", "onAudit", "onUnassign"]) {
      expect(tab, `${KEPT}: ${kept}`).toContain(kept);
    }
    expect(read("pages/Assets/assets.constants.ts"), KEPT).toMatch(/'received',\s*'received_on'/);
  });

  it("keeps explaining the other audit notes", () => {
    expect(auditHistorySummary("Audit Requested", "11/2026 · handover")?.line, KEPT).toBe(
      "For November 2026 · opened when the declaration was signed"
    );
    expect(auditHistorySummary("Audit Requested", "11/2026")?.line, KEPT).toBe("For November 2026 · opened by the monthly run");
  });
});
