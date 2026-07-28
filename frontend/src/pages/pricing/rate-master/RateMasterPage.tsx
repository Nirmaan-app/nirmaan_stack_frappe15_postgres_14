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

import { useMemo, useState } from "react";
import { useFrappeGetCall } from "frappe-react-sdk";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RATE_MASTER_DISCIPLINES } from "./rateMasterRegistry";
import { RateMasterDataViewer } from "./RateMasterDataViewer";
import { RateMasterDerivation } from "./RateMasterDerivation";
import type { GetConfigResponse, GetItemsResponse } from "./rateMasterTypes";

const ITEMS_METHOD = "nirmaan_stack.api.boq.rate_master.get_rate_master_items";
const CONFIG_METHOD = "nirmaan_stack.api.boq.rate_master.get_rate_category_config";

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

  const { data: itemsData, isLoading: itemsLoading, error: itemsError } = useFrappeGetCall<{ message: GetItemsResponse }>(
    ITEMS_METHOD,
    { discipline: disciplineId },
    disciplineId ? `rate-master-items-${disciplineId}` : null
  );
  const { data: configData, isLoading: configLoading, error: configError } = useFrappeGetCall<{ message: GetConfigResponse }>(
    CONFIG_METHOD,
    { discipline: disciplineId, category_id: activeCategoryId },
    disciplineId && activeCategoryId ? `rate-master-config-${disciplineId}-${activeCategoryId}` : null
  );

  const items = itemsData?.message?.items ?? [];
  const config = configData?.message?.config ?? null;
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
          </TabsList>
          <TabsContent value="viewer" className="mt-3">
            <RateMasterDataViewer
              items={items}
              config={config}
              disciplineLabel={discipline?.label ?? disciplineId}
              categoryLabel={categoryLabel}
            />
          </TabsContent>
          <TabsContent value="derivation" className="mt-3">
            <RateMasterDerivation items={items} config={config} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

export { RateMasterPage as Component };
export default RateMasterPage;
