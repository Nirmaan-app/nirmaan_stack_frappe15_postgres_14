// Rate Master (RM-2) -- the read surface for the pricing helper's rate data.
//
// Owner ruling (option a): a Rate Master page beside hvac-/electrical-pricing in
// the Pricing module area, PricingRoute-guarded (UI gate; the endpoints' login
// requirement is the real enforcement). Registry-shaped disciplines (Electrical
// today). Two tabs: DATA VIEWER (the full item master) + DERIVATION (a
// configurator that runs the stored pipelines through the SINGLE pure interpreter
// -- RM-3's helper consumes that same interpreter unchanged).
//
// Lazy route module -- exports `Component` per the M1.59 lazy() contract.

import { useCallback, useMemo, useState } from "react";
import { useFrappeGetCall, useFrappePostCall } from "frappe-react-sdk";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useUserData } from "@/hooks/useUserData";
import { RATE_MASTER_DISCIPLINES } from "./rateMasterRegistry";
import { RateMasterDataViewer } from "./RateMasterDataViewer";
import { RateMasterDerivation } from "./RateMasterDerivation";
import { RateMasterPipelines } from "./RateMasterPipelines";
import { isRateMasterAdmin } from "./rateMasterEdit";
import { downloadBase64, type DownloadPayload } from "./rateMasterDownload";
import type { UploadPlan, UploadResult } from "./rateMasterUpload";
import type { GetConfigResponse, GetItemsResponse, RateCategoryConfig } from "./rateMasterTypes";

const ITEMS_METHOD = "nirmaan_stack.api.boq.rate_master.get_rate_master_items";
const CONFIG_METHOD = "nirmaan_stack.api.boq.rate_master.get_rate_category_config";
// RM-4a: admin-only write endpoints (owner option (a) -- Estimates is READ-ONLY, controls HIDDEN).
const UPDATE_PARAM_METHOD = "nirmaan_stack.api.boq.rate_master.update_rate_config_param";
const UPDATE_ITEM_METHOD = "nirmaan_stack.api.boq.rate_master.update_rate_master_item";
const CREATE_ITEM_METHOD = "nirmaan_stack.api.boq.rate_master.create_rate_master_item";
const DEACTIVATE_ITEM_METHOD = "nirmaan_stack.api.boq.rate_master.deactivate_rate_master_item";
// RM-4b: admin-only whole-config STRUCTURE replace (validated server-side; the authority).
const UPDATE_CONFIG_METHOD = "nirmaan_stack.api.boq.rate_master.update_rate_config";
// SLICE 5: the two download surfaces. Both are ADMIN-gated server-side (_require_rate_admin) --
// hiding the buttons is UX; the endpoints are the boundary.
const EXPORT_CSV_METHOD = "nirmaan_stack.api.boq.rate_master.export_rate_master_csv";
const EXPORT_ASSET_METHOD = "nirmaan_stack.api.boq.rate_master.export_rate_master_asset";
// SLICE 6: the upload. TWO endpoints, never one -- the preview is READ-ONLY and the apply is the
// only writer, so a file can never be applied on arrival. Both are ADMIN-gated server-side.
const PREVIEW_CSV_METHOD = "nirmaan_stack.api.boq.rate_master.preview_rate_master_csv";
const APPLY_CSV_METHOD = "nirmaan_stack.api.boq.rate_master.apply_rate_master_csv";

export function RateMasterPage() {
  const [disciplineId, setDisciplineId] = useState(RATE_MASTER_DISCIPLINES[0]?.discipline ?? "");
  const discipline = useMemo(
    () => RATE_MASTER_DISCIPLINES.find((d) => d.discipline === disciplineId) ?? RATE_MASTER_DISCIPLINES[0],
    [disciplineId]
  );
  const [categoryId, setCategoryId] = useState(discipline?.categories[0]?.category_id ?? "");

  // keep category valid when discipline changes
  const activeCategoryId = useMemo(() => {
    if (discipline?.categories.some((c) => c.category_id === categoryId)) return categoryId;
    return discipline?.categories[0]?.category_id ?? "";
  }, [discipline, categoryId]);

  const { data: itemsData, isLoading: itemsLoading, error: itemsError, mutate: mutateItems } = useFrappeGetCall<{ message: GetItemsResponse }>(
    ITEMS_METHOD,
    { discipline: disciplineId },
    disciplineId ? `rate-master-items-${disciplineId}` : null
  );
  const { data: configData, isLoading: configLoading, error: configError, mutate: mutateConfig } = useFrappeGetCall<{ message: GetConfigResponse }>(
    CONFIG_METHOD,
    { discipline: disciplineId, category_id: activeCategoryId },
    disciplineId && activeCategoryId ? `rate-master-config-${disciplineId}-${activeCategoryId}` : null
  );

  const items = itemsData?.message?.items ?? [];
  const config = configData?.message?.config ?? null;
  const configName = configData?.message?.name;

  // RM-4a: admin gate (owner option (a)). `role` off the already-warm useUserData (PricingRoute warmed
  // it); the pure isRateMasterAdmin mirrors the server _is_nirmaan_admin. When false the tabs render
  // read-only (controls HIDDEN, not disabled). Server-authoritative regardless.
  const { user_id: currentUser, role } = useUserData();
  const isAdmin = isRateMasterAdmin(role, currentUser);

  const { call: callSaveParam } = useFrappePostCall(UPDATE_PARAM_METHOD);
  const { call: callSaveItem } = useFrappePostCall(UPDATE_ITEM_METHOD);
  const { call: callCreateItem } = useFrappePostCall(CREATE_ITEM_METHOD);
  const { call: callDeactivateItem } = useFrappePostCall(DEACTIVATE_ITEM_METHOD);
  const { call: callSaveConfig } = useFrappePostCall(UPDATE_CONFIG_METHOD);
  const { call: callExportCsv } = useFrappePostCall(EXPORT_CSV_METHOD);
  const { call: callExportAsset } = useFrappePostCall(EXPORT_ASSET_METHOD);
  const { call: callPreviewCsv } = useFrappePostCall(PREVIEW_CSV_METHOD);
  const { call: callApplyCsv } = useFrappePostCall(APPLY_CSV_METHOD);

  // Each write refetches its collection so the derivation/viewer recompute live (the persistence split
  // then carries edited params/rates into the next pricing-panel compute with no re-run).
  const onSaveParam = useCallback(
    async (pipelineId: string, stepIndex: number, conditionIndex: number | null, paramKey: string, newValue: number) => {
      if (!configName) throw new Error("No config loaded.");
      await callSaveParam({
        name: configName, pipeline_id: pipelineId, step_index: stepIndex,
        condition_index: conditionIndex ?? undefined, param_key: paramKey, new_value: newValue,
      });
      await mutateConfig();
    },
    [callSaveParam, configName, mutateConfig]
  );
  const onSaveItem = useCallback(
    async (name: string, patch: { rates_patch?: Record<string, number | null>; attributes_patch?: Record<string, string | number> }) => {
      await callSaveItem({
        name,
        rates_patch: patch.rates_patch ? JSON.stringify(patch.rates_patch) : undefined,
        attributes_patch: patch.attributes_patch ? JSON.stringify(patch.attributes_patch) : undefined,
      });
      await mutateItems();
    },
    [callSaveItem, mutateItems]
  );
  const onCreateItem = useCallback(
    async (payload: { kind: string; brand?: string; unit?: string; attributes: Record<string, string | number>; rates: Record<string, number | null> }) => {
      await callCreateItem({
        discipline: disciplineId, kind: payload.kind, brand: payload.brand, unit: payload.unit,
        attributes: JSON.stringify(payload.attributes), rates: JSON.stringify(payload.rates),
      });
      await mutateItems();
    },
    [callCreateItem, disciplineId, mutateItems]
  );
  const onDeactivateItem = useCallback(
    async (name: string) => {
      await callDeactivateItem({ name });
      await mutateItems();
    },
    [callDeactivateItem, mutateItems]
  );

  // SLICE 5 -- the downloads. Both endpoints return the base64-in-JSON triple that
  // export_priced_workbook established, so ONE decoder serves both. `categoryId === null` is MODE B
  // (every category in one file). Nothing is mutated, so neither refetches.
  const onDownloadCsv = useCallback(
    async (categoryId: string | null) => {
      const res = await callExportCsv({
        discipline: disciplineId,
        category_id: categoryId ?? undefined,
      });
      const payload = (res as { message: DownloadPayload }).message;
      downloadBase64(payload, `rate_master_${categoryId ?? "all"}.csv`);
    },
    [callExportCsv, disciplineId]
  );
  const onDownloadAsset = useCallback(
    async () => {
      const res = await callExportAsset({ discipline: disciplineId });
      const payload = (res as { message: DownloadPayload }).message;
      downloadBase64(payload, `rate_master_${disciplineId}.json`);
    },
    [callExportAsset, disciplineId]
  );
  // SLICE 6 -- the upload. The PREVIEW writes nothing, so it deliberately does NOT refetch; the
  // APPLY does, and its refetch is what makes the change visible immediately (the catalog is read
  // at runtime everywhere else too, so extraction values and helper dropdowns follow on their own
  // next read).
  const onPreviewCsv = useCallback(
    async (contentBase64: string) => {
      const res = await callPreviewCsv({ discipline: disciplineId, content_base64: contentBase64 });
      return (res as { message: UploadPlan }).message;
    },
    [callPreviewCsv, disciplineId]
  );
  const onApplyCsv = useCallback(
    async (contentBase64: string, expectedDigest: string) => {
      const res = await callApplyCsv({
        discipline: disciplineId,
        content_base64: contentBase64,
        // The preview's fingerprint. The server re-derives the plan and REFUSES when the catalog
        // moved underneath -- what the user confirmed is then no longer what would happen.
        expected_digest: expectedDigest,
      });
      return (res as { message: UploadResult }).message;
    },
    [callApplyCsv, disciplineId]
  );
  const onUploadApplied = useCallback(() => {
    void mutateItems();
  }, [mutateItems]);

  // RM-4b: whole-config structure replace. The server re-validates (the authority); on success the
  // config refetch flows the new structure into the Derivation + Data tabs and the helper (no re-run).
  const onSaveConfig = useCallback(
    async (nextConfig: RateCategoryConfig) => {
      if (!configName) throw new Error("No config loaded.");
      await callSaveConfig({ name: configName, config: JSON.stringify(nextConfig) });
      await mutateConfig();
    },
    [callSaveConfig, configName, mutateConfig]
  );
  const categoryLabel =
    config?.category_display ??
    discipline?.categories.find((c) => c.category_id === activeCategoryId)?.label ??
    activeCategoryId;

  const loading = itemsLoading || configLoading;
  const error = itemsError || configError;

  return (
    <div className="p-4 space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Rate Master</h1>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Discipline</span>
          <Select value={disciplineId} onValueChange={setDisciplineId}>
            <SelectTrigger className="h-8 w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              {RATE_MASTER_DISCIPLINES.map((d) => (
                <SelectItem key={d.discipline} value={d.discipline}>{d.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Category</span>
          <Select value={activeCategoryId} onValueChange={setCategoryId}>
            <SelectTrigger className="h-8 w-64"><SelectValue /></SelectTrigger>
            <SelectContent>
              {(discipline?.categories ?? []).map((c) => (
                <SelectItem key={c.category_id} value={c.category_id}>
                  {config?.category_id === c.category_id && config?.category_display ? config.category_display : c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {error && (
        <div className="rounded border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          Failed to load rate master: {String((error as { message?: string })?.message ?? error)}
        </div>
      )}

      {loading && !error && <div className="text-sm text-muted-foreground">Loading rate master...</div>}

      {!loading && !error && !config && (
        <div className="text-sm text-muted-foreground">
          No active config found for {disciplineId} / {activeCategoryId}.
        </div>
      )}

      {!loading && !error && config && (
        <Tabs defaultValue="viewer">
          <TabsList>
            <TabsTrigger value="viewer">Data Viewer</TabsTrigger>
            <TabsTrigger value="derivation">Derivation</TabsTrigger>
            <TabsTrigger value="pipelines">Pipelines</TabsTrigger>
          </TabsList>
          <TabsContent value="viewer" className="mt-3">
            <RateMasterDataViewer
              items={items}
              config={config}
              disciplineLabel={discipline?.label ?? disciplineId}
              categoryLabel={categoryLabel}
              isAdmin={isAdmin}
              onDownloadCsv={onDownloadCsv}
              onDownloadAsset={onDownloadAsset}
              onPreviewCsv={onPreviewCsv}
              onApplyCsv={onApplyCsv}
              onUploadApplied={onUploadApplied}
              onSaveItem={onSaveItem}
              onCreateItem={onCreateItem}
              onDeactivateItem={onDeactivateItem}
            />
          </TabsContent>
          <TabsContent value="derivation" className="mt-3">
            <RateMasterDerivation
              items={items}
              config={config}
              isAdmin={isAdmin}
              onSaveParam={onSaveParam}
            />
          </TabsContent>
          <TabsContent value="pipelines" className="mt-3">
            <RateMasterPipelines
              items={items}
              config={config}
              isAdmin={isAdmin}
              onSaveConfig={onSaveConfig}
            />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

export { RateMasterPage as Component };
export default RateMasterPage;
