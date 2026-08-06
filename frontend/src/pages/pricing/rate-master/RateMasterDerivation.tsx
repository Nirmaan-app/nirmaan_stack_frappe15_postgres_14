// RM-2 Tab 2 -- DERIVATION VIEW. A configurator whose selectors are BUILT FROM
// the attribute_definitions (choice -> select of stored values; number -> select
// of the values present in the data; brand shown, not selectable). Below it,
// EVERY pipeline in the stored config renders as an ordered step list (name +
// explain + params + matched condition + running value) with finals as summary
// cards. BCS pipelines ARE shown here (internal transparency); only the
// pricer-facing helper defers them. Honest no-match + unsupported-step states.

import { useMemo, useState } from "react";
import { Pencil, Check, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { AttributeDefinition, RateCategoryConfig, RateMasterItem, StepTrace } from "./rateMasterTypes";
import { NONE_SENTINEL, runAllPipelines } from "./ratePipelineInterpreter";
import { isEditableParam, matchedConditionIndex, parseFiniteInput } from "./rateMasterEdit";

// ---- BLANKER SLICE: DERIVED, READ-ONLY attribute displays ----
//
// THE DEFECT: `blank_qty` sat inert at 0 in the form while the blank line priced at 1, because slice
// 2 part 2 moved that line onto the COMPUTED count (`qty: {from_fit: "blank_count"}`) and stopped
// reading the attribute. The form said one thing and the price said another.
//
// ⚠️ THE DERIVED-NESS IS READ FROM THE CONFIG THAT ALREADY EXISTS -- no new config key, and nothing
// hardcoded by attribute id. An attribute is DERIVED exactly when a component takes its quantity
// from a computed binding INSTEAD of from that attribute, which the stored `qty` already declares:
//   {from_fit: "blank_count"}  -> the attribute is superseded  -> derived, read-only
//   {from_attr: "blank_qty"}   -> the attribute IS the input   -> stays editable
// That distinction is exactly right on live data and needs no asset mint: switches_sockets and
// point_wiring carry the from_fit form, while switches_point still reads `blank_qty` as a genuine
// input and therefore OPTS OUT AUTOMATICALLY. Hardcoding `d.id === "blank_qty"` would have frozen a
// field that is still live there -- the trap the recon flagged.
//
// The `_qty` suffix ties a component to its attribute (`blank` -> `blank_qty`), the SAME convention
// every shipped config already uses (switch/switch_qty, socket1/socket1_qty, plate/plate_qty). The
// second guard makes it airtight: an attribute ANY step still reads via from_attr is never derived,
// so a config that both computes and reads a value keeps the user in control.

/** One derived attribute: the def it covers, and the pipeline ctx key holding its computed value. */
export interface DerivedQtyBinding {
  attrId: string;
  ctxKey: string;
}

/**
 * PURE. The attributes this config DERIVES rather than accepts as input, keyed by attribute id.
 * Empty for every config whose components read their quantities from attributes (the pre-slice
 * shape), so a category that was never migrated is byte-unaffected.
 */
export function derivedQtyAttrs(config: RateCategoryConfig): Map<string, DerivedQtyBinding> {
  const defIds = new Set((config.attribute_definitions ?? []).map((d) => d.id));
  const readAsInput = new Set<string>();
  const candidates = new Map<string, string>();
  for (const pl of Object.values(config.pipelines ?? {})) {
    for (const raw of pl.steps ?? []) {
      const s = raw as { name?: string; qty?: unknown };
      const qty = s.qty as { from_attr?: string; from_fit?: string } | undefined;
      if (!qty || typeof qty !== "object") continue;
      if (typeof qty.from_attr === "string") readAsInput.add(qty.from_attr);
      if (typeof qty.from_fit === "string" && typeof s.name === "string" && s.name) {
        const attrId = `${s.name}_qty`;
        if (defIds.has(attrId)) candidates.set(attrId, qty.from_fit);
      }
    }
  }
  const out = new Map<string, DerivedQtyBinding>();
  for (const [attrId, ctxKey] of candidates) {
    // an attribute ANY step still reads as an input stays the user's to set
    if (readAsInput.has(attrId)) continue;
    out.set(attrId, { attrId, ctxKey });
  }
  return out;
}

/**
 * PURE. The computed value a derived attribute displays, read out of the pipeline traces (the ctx
 * snapshot each step carries). Returns undefined when NOTHING computed it -- e.g. a "None" plate,
 * where blanks are positively absent -- so the caller can render an honest blank rather than a 0
 * that would claim "zero blanks" when the truth is "no plate to fill".
 */
export function derivedQtyValue(
  results: { steps: StepTrace[] }[],
  ctxKey: string,
): number | undefined {
  for (const r of results) {
    for (const st of r.steps) {
      const v = st.runningValues?.[ctxKey];
      if (typeof v === "number" && Number.isFinite(v)) return v;
    }
  }
  return undefined;
}

interface Props {
  items: RateMasterItem[];
  config: RateCategoryConfig;
  // RM-4a: admin-only inline param editing. Non-admins render today's read-only view (controls HIDDEN).
  isAdmin?: boolean;
  onSaveParam?: (
    pipelineId: string,
    stepIndex: number,
    conditionIndex: number | null,
    paramKey: string,
    newValue: number,
  ) => Promise<void>;
}

// RM-4a: one numeric parameter, admin-inline-editable (pencil -> input -> save/cancel; Escape cancels;
// Enter saves). Save calls the param endpoint (via onSave); the page refetches + the derivation
// recomputes. Read-only string params (e.g. `kind`) never reach this -- they render as plain text.
function InlineParamEdit({
  paramKey,
  value,
  onSave,
}: {
  paramKey: string;
  value: number;
  onSave: (v: number) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const begin = () => {
    setDraft(String(value));
    setErr(null);
    setEditing(true);
  };
  const cancel = () => {
    setEditing(false);
    setErr(null);
  };
  const commit = async () => {
    const n = parseFiniteInput(draft);
    if (n === null) {
      setErr("Enter a number");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      await onSave(n);
      setEditing(false);
    } catch (e) {
      setErr((e as { message?: string })?.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-muted/50 px-1.5 py-0.5 font-mono">
        {paramKey} {value}
        <button
          type="button"
          aria-label={`Edit ${paramKey}`}
          onClick={begin}
          className="text-muted-foreground hover:text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <Pencil className="h-3 w-3" />
        </button>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1">
      <span className="font-mono">{paramKey}</span>
      <Input
        autoFocus
        className="h-6 w-20 text-xs"
        value={draft}
        disabled={saving}
        inputMode="decimal"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void commit();
          else if (e.key === "Escape") cancel();
        }}
        aria-label={`${paramKey} value`}
      />
      <button type="button" aria-label="Save" disabled={saving} onClick={() => void commit()} className="text-emerald-600 hover:text-emerald-700 disabled:opacity-50">
        <Check className="h-3.5 w-3.5" />
      </button>
      <button type="button" aria-label="Cancel" disabled={saving} onClick={cancel} className="text-muted-foreground hover:text-foreground disabled:opacity-50">
        <X className="h-3.5 w-3.5" />
      </button>
      {err && <span className="text-[10px] text-destructive">{err}</span>}
    </span>
  );
}

function fmt(v: number | undefined): string {
  if (v === undefined || !Number.isFinite(v)) return "-";
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

function detailFor(s: StepTrace): string {
  // EA-2c: component_ref names the referenced row (e.g. "Bus bar") so the trace shows WHICH row
  // supplied the base, alongside its resolved params.
  if (s.refItem) {
    const p = s.params && Object.keys(s.params).length
      ? " -- " + Object.entries(s.params).map(([k, v]) => `${k} ${v}`).join(", ")
      : "";
    const cond = s.matchedCondition ? ` (${s.matchedCondition})` : "";
    return `ref: ${s.refItem}${p}${cond}`;
  }
  if (s.matchedCondition) return s.matchedCondition;
  if (s.bandChosen) return s.bandChosen;
  if (s.params && Object.keys(s.params).length) {
    return Object.entries(s.params).map(([k, v]) => `${k} ${v}`).join(", ");
  }
  return "";
}

export function RateMasterDerivation({ items, config, isAdmin, onSaveParam }: Props) {
  // EA-4 ext-a: tolerate a config with no rules key at all (every category except the two that
  // carry one) -- an absent key renders the empty state, never a crash.
  const rules = useMemo(
    () => (Array.isArray(config.rules) ? config.rules : []),
    [config]
  );
  const selectableDefs = useMemo(
    () => config.attribute_definitions.filter((d) => d.selector !== false),
    [config]
  );
  const brandDef = useMemo(
    () => config.attribute_definitions.find((d) => d.id === "brand"),
    [config]
  );

  // EA-4a: a choice def may resolve its allowed values FROM the live master (values_from) rather than a
  // static `values` list -- point_wiring's switch/socket/plate selects, keyed by family. Resolve them
  // here from `items` (the FULL discipline set the page passes), the SAME live read the backend uses.
  const valuesFromOptions = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const d of selectableDefs) {
      const vf = d.values_from;
      if (!vf) continue;
      const seen = new Set<string>();
      const opts: string[] = [];
      for (const it of items) {
        if (it.kind !== vf.kind) continue;
        const a = it.attributes ?? {};
        if (!Object.entries(vf.where ?? {}).every(([k, v]) => a[k] === v)) continue;
        const raw = a[vf.attr];
        const val = typeof raw === "string" ? raw.trim() : raw;
        if (val !== undefined && val !== null && val !== "" && !seen.has(String(val))) {
          seen.add(String(val));
          opts.push(String(val));
        }
      }
      out[d.id] = opts;
    }
    return out;
  }, [selectableDefs, items]);
  const optionsFor = (d: AttributeDefinition): string[] => {
    const base = d.values_from ? (valuesFromOptions[d.id] ?? []) : (d.values ?? []).map((v) => String(v));
    // EA-4a-r: an allow_none def offers the "None" sentinel (positive absence) at the TOP.
    return d.allow_none ? [NONE_SENTINEL, ...base] : base;
  };

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

  // default selection: the first item's attributes (guarantees a match for a category that owns its
  // rows). EA-4a: an ASSEMBLY category (point_wiring) owns NO rows of its own, so items[0] doesn't carry
  // its defs -- seed each unfilled def from its `default`, then the config's first stored golden (so the
  // Derivation opens in a COMPUTABLE state showing the golden), then the first option (incl. values_from),
  // then the first data number.
  const [selected, setSelected] = useState<Record<string, string | number>>(() => {
    const init: Record<string, string | number> = {};
    const seed = items[0]?.attributes ?? {};
    const golden0 = (config.goldens as Array<{ attrs?: Record<string, string | number> }> | undefined)?.[0]?.attrs ?? {};
    for (const d of selectableDefs) {
      if (seed[d.id] !== undefined) {
        init[d.id] = seed[d.id];
      } else if (d.default !== undefined) {
        init[d.id] = d.default;
      } else if (golden0[d.id] !== undefined) {
        init[d.id] = golden0[d.id];
      } else if (d.type === "choice") {
        const opts = optionsFor(d);
        if (opts.length) init[d.id] = opts[0];
      } else if (d.type === "number" && numberValues[d.id]?.length) {
        init[d.id] = numberValues[d.id][0];
      }
    }
    return init;
  });

  const setAttr = (def: AttributeDefinition, raw: string) => {
    setSelected((prev) => {
      // EA-4a-r: preserve the "None" sentinel verbatim for an allow_none def (never Number("None")=NaN);
      // an empty number (e.g. unchecking None) clears to "" (not 0); CLEAR its disables_when_none targets.
      const val =
        def.allow_none && raw === NONE_SENTINEL
          ? NONE_SENTINEL
          : def.type === "number"
            ? raw === "" ? "" : Number(raw)
            : raw;
      const next = { ...prev, [def.id]: val };
      if (def.allow_none) {
        for (const t of def.disables_when_none ?? []) {
          if (val === NONE_SENTINEL) delete next[t];
        }
      }
      return next;
    });
  };

  // EA-4a-r: defs greyed because an allow_none controller is set to "None" (positive absence).
  const disabledByNone = useMemo(() => {
    const s = new Set<string>();
    for (const d of selectableDefs) {
      if (d.allow_none && d.disables_when_none && selected[d.id] === NONE_SENTINEL) {
        for (const t of d.disables_when_none) s.add(t);
      }
    }
    return s;
  }, [selectableDefs, selected]);

  const results = useMemo(
    () => runAllPipelines(config, items, selected),
    [config, items, selected]
  );

  // BLANKER SLICE: the attributes this config computes rather than accepts (see derivedQtyAttrs).
  // ⚠️ DISPLAY ONLY -- the computed value is NEVER written back into `selected`. `selected` means
  // "what the user or extraction supplied"; writing a derived value into it would make the two
  // indistinguishable, and every later reader would treat a computed number as a stated one.
  // Because `results` is recomputed on every `selected` change, the display updates live for free.
  const derivedAttrs = useMemo(() => derivedQtyAttrs(config), [config]);

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
              if (d.type === "number") {
                // EA-2 rider 2: a FREE numeric input with the data-present distinct values offered as
                // datalist SUGGESTIONS -- a number attribute with no matching data (e.g. module_count)
                // still accepts any typed number, instead of rendering an empty, unusable Select.
                const listId = `rmnum-${d.id}`;
                const suggestions = numberValues[d.id] ?? [];
                const isNone = selected[d.id] === NONE_SENTINEL;
                // BLANKER SLICE: a DERIVED attribute shows the COMPUTED value and is never editable.
                // An undefined computed value renders EMPTY, not 0 -- with a "None" plate there are
                // no blanks at all, and a 0 would claim "zero needed" instead of "not applicable".
                const derived = derivedAttrs.get(d.id);
                const derivedValue = derived ? derivedQtyValue(results, derived.ctxKey) : undefined;
                return (
                  <div key={d.id} className="flex flex-col gap-1">
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      {d.label}
                      {derived && <span className="text-[10px] italic">(computed)</span>}
                      {/* EA-4a-r: a NUMBER allow_none def offers "None" (positive absence) as a checkbox --
                          the input-appropriate analogue of a choice def's top-of-list "None". */}
                      {d.allow_none && !derived && (
                        <label className="flex items-center gap-0.5 text-[10px]">
                          <input
                            type="checkbox"
                            checked={isNone}
                            onChange={(e) => setAttr(d, e.target.checked ? NONE_SENTINEL : "")}
                          />
                          None
                        </label>
                      )}
                    </label>
                    <input
                      type="number"
                      list={derived ? undefined : listId}
                      value={
                        derived
                          ? (derivedValue === undefined ? "" : String(derivedValue))
                          : isNone ? "" : String(selected[d.id] ?? "")
                      }
                      onChange={(e) => setAttr(d, e.target.value)}
                      readOnly={!!derived}
                      disabled={!!derived || disabledByNone.has(d.id) || isNone}
                      title={derived ? `Computed from the assembly (${derived.ctxKey}) -- not editable` : undefined}
                      placeholder={derived ? "-" : isNone ? "None" : `Enter ${d.label}`}
                      className="h-8 w-44 rounded border bg-background px-3 text-sm disabled:opacity-50"
                    />
                    <datalist id={listId}>
                      {suggestions.map((v) => (
                        <option key={v} value={String(v)} />
                      ))}
                    </datalist>
                  </div>
                );
              }
              const options = optionsFor(d);
              return (
                <div key={d.id} className="flex flex-col gap-1">
                  <label className="text-xs text-muted-foreground">
                    {d.label}
                    {d.default !== undefined && (
                      <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                        default {String(d.default)}
                      </span>
                    )}
                  </label>
                  <Select value={String(selected[d.id] ?? "")} onValueChange={(v) => setAttr(d, v)} disabled={disabledByNone.has(d.id)}>
                    <SelectTrigger className="h-8 w-44 disabled:opacity-50">
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

      {/* EA-4 ext-a: RULES -- owner-authored estimator guidance, read-only. It is the SAME text the
          extraction prompt receives verbatim, so this panel is what the config actually tells the AI,
          not a paraphrase. Unlike the pipelines grid below, it renders an explicit empty state: the
          Derivation tab had no empty-state precedent (a config with no pipelines simply drew blank
          space), and silent blankness reads as "broken" rather than "none configured". */}
      <Card data-testid="rate-master-rules-panel">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Rules</CardTitle>
        </CardHeader>
        <CardContent>
          {rules.length === 0 ? (
            <p className="text-sm text-muted-foreground">No rules configured for this category.</p>
          ) : (
            <ul className="space-y-3">
              {rules.map((r) => (
                <li key={r.id} className="rounded border bg-muted/30 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="font-mono text-xs">{r.id}</Badge>
                    <span className="text-sm font-medium">{r.label}</span>
                    {r.applies_to && (
                      <span className="font-mono text-xs text-muted-foreground">{r.applies_to}</span>
                    )}
                  </div>
                  <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{r.guidance}</p>
                </li>
              ))}
            </ul>
          )}
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
                        <td className="py-1 pr-2 align-top">
                          {(() => {
                            // RM-4a: address the CONFIG path for this step so numeric params can be
                            // edited inline (admin). condIdx re-derives the matched branch exactly as
                            // the interpreter did (no interpreter change). String params (kind) + the
                            // condition `when` stay read-only; editing STRUCTURE is RM-4b.
                            const configStep = (config.pipelines?.[r.pipelineId]?.steps?.[i] ?? undefined) as
                              | { conditions?: { when: Record<string, string | number>; params: Record<string, number> }[] }
                              | undefined;
                            const condIdx = matchedConditionIndex(configStep, r.matchedItem?.attributes);
                            const whenLabel =
                              condIdx !== null && configStep?.conditions
                                ? Object.entries(configStep.conditions[condIdx].when)
                                    .map(([k, v]) => `${k} = ${v}`)
                                    .join(", ")
                                : s.bandChosen ?? null;
                            const entries = Object.entries(s.params ?? {});
                            if (entries.length === 0) return detailFor(s);
                            return (
                              <div className="space-y-1">
                                {whenLabel && <div className="text-muted-foreground">{whenLabel}</div>}
                                <div className="flex flex-wrap items-center gap-1.5">
                                  {entries.map(([key, value]) =>
                                    isAdmin && onSaveParam && isEditableParam(value) ? (
                                      <InlineParamEdit
                                        key={key}
                                        paramKey={key}
                                        value={value}
                                        onSave={(v) => onSaveParam(r.pipelineId, i, condIdx, key, v)}
                                      />
                                    ) : (
                                      <span
                                        key={key}
                                        className="rounded bg-muted/50 px-1.5 py-0.5 font-mono text-muted-foreground"
                                      >
                                        {key} {String(value)}
                                      </span>
                                    ),
                                  )}
                                </div>
                              </div>
                            );
                          })()}
                        </td>
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
