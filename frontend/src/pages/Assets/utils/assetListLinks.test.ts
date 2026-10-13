import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { decodeFiltersFromUrl } from "@/hooks/useServerDataTable";
import { assetListParams, assetListSyncKey } from "./assetListLinks";

describe("assetListParams", () => {
  it("opens a Project list without tab or view params (both are the defaults)", () => {
    expect(assetListParams({ type: "Project", view: "all" })).toEqual({
      asset_master_project_q: null,
      asset_master_project_pageIdx: "0",
      asset_master_project_filters: null,
      view: null,
      tab: null,
    });
  });

  it("opens an IT sub-tab on page 1 with its search and filters cleared", () => {
    expect(assetListParams({ type: "IT", view: "pending" })).toEqual({
      pending_actions_it_q: null,
      pending_actions_it_pageIdx: "0",
      pending_actions_it_filters: null,
      view: "pending",
      tab: "it",
    });
  });

  it("filters the Unassigned list to a chip's category", () => {
    const params = assetListParams({ type: "IT", view: "unassigned", category: "Laptop" });
    expect(decodeFiltersFromUrl(params.unassigned_assets_it_filters)).toEqual([
      { id: "asset_category", value: ["Laptop"] },
    ]);
    expect(params.view).toBe("unassigned");
    expect(params.tab).toBe("it");
  });

  it("writes the list's params before view and tab", () => {
    expect(Object.keys(assetListParams({ type: "Project", view: "assigned" })).slice(-2)).toEqual(["view", "tab"]);
  });
});

describe("assetListSyncKey", () => {
  // The keys must match what each list passes to useServerDataTable, or the card opens the
  // right tab but leaves the old search and filters on the list.
  it.each([
    ["AssetMasterList.tsx", "all", "asset_master_"],
    ["AssignedAssetsList.tsx", "assigned", "assigned_assets_"],
    ["UnassignedAssetsList.tsx", "unassigned", "unassigned_assets_"],
    ["PendingActionsList.tsx", "pending", "pending_actions_"],
  ] as const)("matches %s", (file, view, prefix) => {
    const source = readFileSync(resolve(__dirname, "../components", file), "utf-8");
    expect(source).toContain(`urlSyncKey: assetType ? \`${prefix}\${assetType.toLowerCase()}\``);
    expect(assetListSyncKey("Project", view)).toBe(`${prefix}project`);
    expect(assetListSyncKey("IT", view)).toBe(`${prefix}it`);
  });

  it("matches ReturnRequestsList.tsx (Return By always has a type)", () => {
    const source = readFileSync(resolve(__dirname, "../components/ReturnRequestsList.tsx"), "utf-8");
    expect(source).toContain("urlSyncKey: `return_requests_${assetType.toLowerCase()}`");
    expect(assetListSyncKey("IT", "returns")).toBe("return_requests_it");
  });

  it("filters on the Unassigned list's Category facet column", () => {
    const source = readFileSync(resolve(__dirname, "../components/UnassignedAssetsList.tsx"), "utf-8");
    expect(source).toContain("accessorKey: 'asset_category'");
  });
});
