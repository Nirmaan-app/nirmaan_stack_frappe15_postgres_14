// RM-2 Tab 2 -- DERIVATION VIEW. A configurator whose selectors are BUILT FROM
// the attribute_definitions (choice -> select of stored values; number -> select
// of the values present in the data; brand shown, not selectable). Below it,
// EVERY pipeline in the stored config renders as an ordered step list (name +
// explain + params + matched condition + running value) with finals as summary
// cards. BCS pipelines ARE shown here (internal transparency); only the
// pricer-facing helper defers them. Honest no-match + unsupported-step states.

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { AttributeDefinition, RateCategoryConfig, RateMasterItem, StepTrace } from "./rateMasterTypes";
import { runAllPipelines } from "./ratePipelineInterpreter";

interface Props {
  items: RateMasterItem[];
  config: RateCategoryConfig;
}

function fmt(v: number | undefined): string {
  if (v === undefined || !Number.isFinite(v)) return "-";
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

function detailFor(s: StepTrace): string {
  if (s.matchedCondition) return s.matchedCondition;
  if (s.bandChosen) return s.bandChosen;
  if (s.params && Object.keys(s.params).length) {
    return Object.entries(s.params).map(([k, v]) => `${k} ${v}`).join(", ");
  }
  return "";
}

export function RateMasterDerivation({ items, config }: Props) {
  const selectableDefs = useMemo(
    () => config.attribute_definitions.filter((d) => d.selector !== false),
    [config]
  );
  const brandDef = useMemo(
    () => config.attribute_definitions.find((d) => d.id === "brand"),
    [config]
  );

  // distinct number-attr values present in the data, sorted ascending
  const numberValues = useMemo(() => {
    const out: Record<string, number[]> = {};
    for (const d of selectableDefs) {
      if (d.type !== "number") continue;
      const set = new Set<number>();
      for (const it of items) {
        const v = it.attributes?.[d.id];
        if (typeof v === "number") set.add(v);
      }
      out[d.id] = Array.from(set).sort((a, b) => a - b);
    }
    return out;
  }, [selectableDefs, items]);

  // default selection = the first item's attributes (guarantees at least one match on load)
  const [selected, setSelected] = useState<Record<string, string | number>>(() => {
    const init: Record<string, string | number> = {};
    const seed = items[0]?.attributes ?? {};
    for (const d of selectableDefs) {
      if (seed[d.id] !== undefined) {
        init[d.id] = seed[d.id];
      } else if (d.type === "choice" && d.values?.length) {
        init[d.id] = d.values[0];
      } else if (d.type === "number" && numberValues[d.id]?.length) {
        init[d.id] = numberValues[d.id][0];
      }
    }
    return init;
  });

  const setAttr = (def: AttributeDefinition, raw: string) => {
    setSelected((prev) => ({
      ...prev,
      [def.id]: def.type === "number" ? Number(raw) : raw,
    }));
  };

  const results = useMemo(
    () => runAllPipelines(config, items, selected),
    [config, items, selected]
  );

  const brandValue = brandDef?.values?.[0] ?? items[0]?.brand ?? "-";

  return (
    <div className="space-y-4">
      {/* configurator */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Configure attributes</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4">
            {selectableDefs.map((d) => {
              const options =
                d.type === "choice"
                  ? (d.values ?? []).map((v) => String(v))
                  : (numberValues[d.id] ?? []).map((v) => String(v));
              return (
                <div key={d.id} className="flex flex-col gap-1">
                  <label className="text-xs text-muted-foreground">{d.label}</label>
                  <Select value={String(selected[d.id] ?? "")} onValueChange={(v) => setAttr(d, v)}>
                    <SelectTrigger className="h-8 w-44">
                      <SelectValue placeholder={`Select ${d.label}`} />
                    </SelectTrigger>
                    <SelectContent>
                      {options.map((o) => (
                        <SelectItem key={o} value={o}>{o}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              );
            })}
            {/* brand: shown, not selectable */}
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">{brandDef?.label ?? "Brand"}</label>
              <div className="flex h-8 items-center rounded border px-3 text-sm text-muted-foreground">
                {brandValue} <span className="ml-1 text-xs">(fixed)</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* pipelines */}
      <div className="grid gap-4 md:grid-cols-2">
        {results.map((r) => (
          <Card key={r.pipelineId}>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between text-sm">
                <span className="font-mono">{r.pipelineId}</span>
                {r.status === "no_match" && <Badge variant="destructive">no match</Badge>}
                {r.status === "unsupported" && <Badge variant="destructive">unsupported step</Badge>}
              </CardTitle>
              {r.note && <p className="text-xs text-muted-foreground">{r.note}</p>}
            </CardHeader>
            <CardContent className="space-y-3">
              {/* finals */}
              {r.status === "ok" ? (
                <div className="flex flex-wrap gap-2">
                  {r.outputs.map((o) => (
                    <div key={o} className="rounded border bg-muted/40 px-3 py-1.5">
                      <div className="text-xs text-muted-foreground">{o}</div>
                      <div className="text-lg font-semibold tabular-nums">{fmt(r.finals[o])}</div>
                    </div>
                  ))}
                </div>
              ) : r.status === "no_match" ? (
                <p className="text-sm text-muted-foreground">
                  No master row for this attribute combination -- no values computed.
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  This pipeline uses a step type this viewer does not support yet -- no values computed.
                </p>
              )}

              {/* steps */}
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-muted-foreground">
                      <th className="py-1 pr-2">step</th>
                      <th className="py-1 pr-2">detail</th>
                      <th className="py-1 pr-2 text-right">value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.steps.map((s, i) => (
                      <tr key={i} className={s.unsupported ? "text-destructive" : ""}>
                        <td className="py-1 pr-2 align-top">
                          <div className="font-mono">{s.step}</div>
                          <div className="text-muted-foreground">{s.label}</div>
                        </td>
                        <td className="py-1 pr-2 align-top">{detailFor(s)}</td>
                        <td className="py-1 pr-2 text-right align-top tabular-nums">
                          {s.produced ? `${s.produced.key} = ${fmt(s.produced.value)}` : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
