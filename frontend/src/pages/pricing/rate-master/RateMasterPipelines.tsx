// RM-2 Tab 3 -- PIPELINES (the STRUCTURE view + admin structure editor).
//
// READ-ONLY for everyone: the attribute definitions + every pipeline as its ordered step list with
// params / conditions / bands rendered readably, plus the stored goldens.
//
// ADMIN EDIT MODE (owner option (a): hide-not-disable): "Edit structure" builds a DRAFT (a deep clone
// of the config). The admin can add/remove/reorder steps (a vocabulary picker), add/remove/rename step
// params, add/remove/edit condition branches + component bands, add/edit/remove attribute definitions,
// and toggle the brand selector flag. THE PREVIEW GATE: before save the page computes every stored
// golden against the DRAFT (the SAME pure interpreter + the live master items) and shows a pass/delta
// table; an unchanged draft saves green, any delta requires an explicit "Save with N changed goldens"
// confirmation (deltas listed -- confirm-not-block). Save calls update_rate_config; the server
// re-validates (the authority) and the page refetches. RM-4b lifts the RM-4a param-values-only line.

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { AttributeDefinition, RateCategoryConfig, RateMasterItem } from "./rateMasterTypes";
import {
  STEP_VOCABULARY, StepType, blankAttributeDefinition, blankStep, cloneConfig, evaluateGoldens,
  goldenDeltas, referencedAttrIds,
} from "./rateMasterStructure";

interface Props {
  config: RateCategoryConfig;
  items: RateMasterItem[];
  isAdmin?: boolean;
  onSaveConfig?: (config: RateCategoryConfig) => Promise<void>;
}

// A generic {key -> finite number} params editor (add / rename / edit value / remove).
function ParamsEditor({
  params, onChange,
}: {
  params: Record<string, number>;
  onChange: (next: Record<string, number>) => void;
}) {
  const entries = Object.entries(params ?? {});
  const rename = (oldKey: string, newKey: string) => {
    const next: Record<string, number> = {};
    for (const [k, v] of Object.entries(params)) next[k === oldKey ? newKey : k] = v;
    onChange(next);
  };
  return (
    <div className="space-y-1">
      {entries.map(([k, v]) => (
        <div key={k} className="flex items-center gap-1">
          <Input className="h-6 w-28 text-xs" value={k} aria-label="param name" onChange={(e) => rename(k, e.target.value)} />
          <span className="text-muted-foreground">=</span>
          <Input
            className="h-6 w-20 text-xs" value={String(v)} inputMode="decimal" aria-label={`${k} value`}
            onChange={(e) => onChange({ ...params, [k]: Number(e.target.value) })}
          />
          <button type="button" aria-label={`remove ${k}`} onClick={() => { const n = { ...params }; delete n[k]; onChange(n); }} className="text-muted-foreground hover:text-destructive">
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      ))}
      <Button type="button" size="sm" variant="ghost" className="h-6 px-1 text-xs" onClick={() => onChange({ ...params, [`param${entries.length + 1}`]: 0 })}>
        <Plus className="mr-1 h-3 w-3" /> param
      </Button>
    </div>
  );
}

// Condition branches for apply_effective_multiplier: each = { when: {attr: value}, params }.
function ConditionsEditor({
  conditions, attrDefs, onChange,
}: {
  conditions: { when: Record<string, string | number>; params: Record<string, number> }[];
  attrDefs: AttributeDefinition[];
  onChange: (next: { when: Record<string, string | number>; params: Record<string, number> }[]) => void;
}) {
  const setCond = (i: number, patch: Partial<{ when: Record<string, string | number>; params: Record<string, number> }>) => {
    onChange(conditions.map((c, ci) => (ci === i ? { ...c, ...patch } : c)));
  };
  return (
    <div className="space-y-2">
      {conditions.map((c, i) => {
        const [attr] = Object.keys(c.when ?? {});
        const val = attr !== undefined ? c.when[attr] : "";
        return (
          <div key={i} className="rounded border border-muted p-1.5">
            <div className="mb-1 flex items-center gap-1 text-xs">
              <span className="text-muted-foreground">when</span>
              <Select value={attr ?? ""} onValueChange={(a) => setCond(i, { when: { [a]: val } })}>
                <SelectTrigger className="h-6 w-32 text-xs"><SelectValue placeholder="attribute" /></SelectTrigger>
                <SelectContent>
                  {attrDefs.map((d) => <SelectItem key={d.id} value={d.id}>{d.id}</SelectItem>)}
                </SelectContent>
              </Select>
              <span className="text-muted-foreground">=</span>
              <Input className="h-6 w-28 text-xs" value={String(val)} aria-label="condition value" onChange={(e) => attr && setCond(i, { when: { [attr]: e.target.value } })} />
              <button type="button" aria-label={`remove condition ${i}`} onClick={() => onChange(conditions.filter((_, ci) => ci !== i))} className="ml-auto text-muted-foreground hover:text-destructive">
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
            <ParamsEditor params={c.params ?? {}} onChange={(p) => setCond(i, { params: p })} />
          </div>
        );
      })}
      <Button type="button" size="sm" variant="ghost" className="h-6 px-1 text-xs" onClick={() => onChange([...conditions, { when: {}, params: {} }])}>
        <Plus className="mr-1 h-3 w-3" /> condition
      </Button>
    </div>
  );
}

// component_band bands: each = { when: comparator-string, target }.
function BandsEditor({
  bands, onChange,
}: {
  bands: { when: string; target: string }[];
  onChange: (next: { when: string; target: string }[]) => void;
}) {
  const setBand = (i: number, patch: Partial<{ when: string; target: string }>) =>
    onChange(bands.map((b, bi) => (bi === i ? { ...b, ...patch } : b)));
  return (
    <div className="space-y-1">
      {bands.map((b, i) => (
        <div key={i} className="flex items-center gap-1 text-xs">
          <span className="text-muted-foreground">when</span>
          <Input className="h-6 w-20 text-xs" value={b.when} placeholder="<35" aria-label="band when" onChange={(e) => setBand(i, { when: e.target.value })} />
          <span className="text-muted-foreground">-&gt;</span>
          <Input className="h-6 w-36 text-xs" value={b.target} placeholder="target rate key" aria-label="band target" onChange={(e) => setBand(i, { target: e.target.value })} />
          <button type="button" aria-label={`remove band ${i}`} onClick={() => onChange(bands.filter((_, bi) => bi !== i))} className="text-muted-foreground hover:text-destructive">
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      ))}
      <Button type="button" size="sm" variant="ghost" className="h-6 px-1 text-xs" onClick={() => onChange([...bands, { when: "<35", target: "" }])}>
        <Plus className="mr-1 h-3 w-3" /> band
      </Button>
    </div>
  );
}

const STR_FIELDS: Record<string, string[]> = {
  match_master_row: [],
  apply_effective_multiplier: ["target", "result", "formula"],
  scale: ["target", "result", "formula"],
  roundup: ["target"],
  component: ["name", "target", "formula"],
  component_band: ["name", "band_on", "formula"],
  sum_components: ["result"],
  install_as_ratio: ["result"],
};

// A single editable step (its string fields + params/conditions/bands + reorder/remove).
function StepEditor({
  step, index, total, attrDefs, onPatch, onMove, onRemove,
}: {
  step: Record<string, unknown>;
  index: number;
  total: number;
  attrDefs: AttributeDefinition[];
  onPatch: (patch: Record<string, unknown>) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
}) {
  const type = String(step.step) as StepType;
  const strFields = STR_FIELDS[type] ?? [];
  return (
    <div className="rounded border p-2 text-xs">
      <div className="mb-1 flex items-center gap-2">
        <Badge variant="secondary" className="font-mono">{type}</Badge>
        <span className="text-muted-foreground">step {index}</span>
        <div className="ml-auto flex items-center gap-1">
          <button type="button" aria-label="move up" disabled={index === 0} onClick={() => onMove(-1)} className="text-muted-foreground hover:text-foreground disabled:opacity-30"><ArrowUp className="h-3.5 w-3.5" /></button>
          <button type="button" aria-label="move down" disabled={index === total - 1} onClick={() => onMove(1)} className="text-muted-foreground hover:text-foreground disabled:opacity-30"><ArrowDown className="h-3.5 w-3.5" /></button>
          <button type="button" aria-label="remove step" onClick={onRemove} className="text-muted-foreground hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
      </div>
      <div className="space-y-1.5 pl-1">
        {type === "match_master_row" && (
          <label className="flex items-center gap-1">kind
            <Input className="h-6 w-28 text-xs" value={String((step.params as { kind?: string })?.kind ?? "")} aria-label="kind" onChange={(e) => onPatch({ params: { kind: e.target.value } })} />
          </label>
        )}
        {strFields.map((f) => (
          <label key={f} className="flex items-center gap-1">
            <span className="w-16 text-muted-foreground">{f}</span>
            <Input className="h-6 w-48 text-xs" value={String(step[f] ?? "")} aria-label={f} onChange={(e) => onPatch({ [f]: e.target.value })} />
          </label>
        ))}
        {type === "roundup" && (
          <label className="flex items-center gap-1"><span className="w-16 text-muted-foreground">digits</span>
            <Input className="h-6 w-20 text-xs" value={String((step.params as { digits?: number })?.digits ?? 0)} inputMode="decimal" aria-label="digits" onChange={(e) => onPatch({ params: { digits: Number(e.target.value) } })} />
          </label>
        )}
        {type === "install_as_ratio" && (
          <label className="flex items-center gap-1"><span className="w-16 text-muted-foreground">ratio</span>
            <Input className="h-6 w-20 text-xs" value={String((step.params as { ratio?: number })?.ratio ?? 0)} inputMode="decimal" aria-label="ratio" onChange={(e) => onPatch({ params: { ratio: Number(e.target.value) } })} />
          </label>
        )}
        {(type === "scale" || type === "component") && (
          <div><div className="text-muted-foreground">params</div><ParamsEditor params={(step.params as Record<string, number>) ?? {}} onChange={(p) => onPatch({ params: p })} /></div>
        )}
        {type === "apply_effective_multiplier" && (
          <div><div className="text-muted-foreground">conditions</div>
            <ConditionsEditor conditions={(step.conditions as { when: Record<string, string | number>; params: Record<string, number> }[]) ?? []} attrDefs={attrDefs} onChange={(c) => onPatch({ conditions: c })} />
          </div>
        )}
        {type === "component_band" && (
          <>
            <div><div className="text-muted-foreground">bands</div>
              <BandsEditor bands={(step.bands as { when: string; target: string }[]) ?? []} onChange={(b) => onPatch({ bands: b })} />
            </div>
            <div><div className="text-muted-foreground">params</div><ParamsEditor params={(step.params as Record<string, number>) ?? {}} onChange={(p) => onPatch({ params: p })} /></div>
          </>
        )}
      </div>
    </div>
  );
}

// ---- read-only renderers ----
function readableStep(step: Record<string, unknown>): string {
  const type = String(step.step);
  if (type === "match_master_row") return `kind = ${(step.params as { kind?: string })?.kind}`;
  if (type === "apply_effective_multiplier") {
    const conds = (step.conditions as { when: Record<string, string | number>; params: Record<string, number> }[]) ?? [];
    return conds.map((c) => `${Object.entries(c.when).map(([k, v]) => `${k}=${v}`).join(",")} -> ${Object.entries(c.params).map(([k, v]) => `${k} ${v}`).join(", ")}`).join("  |  ");
  }
  if (type === "roundup") return `digits ${(step.params as { digits?: number })?.digits}`;
  if (type === "install_as_ratio") return `ratio ${(step.params as { ratio?: number })?.ratio}`;
  if (type === "component_band") {
    const bands = (step.bands as { when: string; target: string }[]) ?? [];
    return `band_on ${step.band_on}: ${bands.map((b) => `${b.when}->${b.target}`).join(", ")}`;
  }
  if (step.params && Object.keys(step.params).length) return Object.entries(step.params as Record<string, number>).map(([k, v]) => `${k} ${v}`).join(", ");
  return "";
}

export function RateMasterPipelines({ config, items, isAdmin, onSaveConfig }: Props) {
  const [draft, setDraft] = useState<RateCategoryConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const editing = draft !== null;
  const view = draft ?? config;

  const updateDraft = (mutate: (d: RateCategoryConfig) => void) =>
    setDraft((prev) => { if (!prev) return prev; const next = cloneConfig(prev); mutate(next); return next; });

  const deltas = useMemo(() => (editing ? goldenDeltas(view, items) : []), [editing, view, items]);
  const allChecks = useMemo(() => (editing ? evaluateGoldens(view, items) : []), [editing, view, items]);
  const refIds = useMemo(() => referencedAttrIds(view), [view]);

  const begin = () => { setErr(null); setDraft(cloneConfig(config)); };
  const cancel = () => { setDraft(null); setErr(null); setConfirmOpen(false); };
  const doSave = async () => {
    if (!draft || !onSaveConfig) return;
    setSaving(true); setErr(null);
    try {
      await onSaveConfig(draft);
      setDraft(null); setConfirmOpen(false);
    } catch (e) {
      setErr((e as { message?: string })?.message ?? "Save failed");
      setConfirmOpen(false);
    } finally { setSaving(false); }
  };
  const onSaveClick = () => { if (deltas.length > 0) setConfirmOpen(true); else void doSave(); };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold">Pipelines &amp; attributes</h2>
        {isAdmin && onSaveConfig && !editing && (
          <Button type="button" size="sm" variant="outline" onClick={begin}>Edit structure</Button>
        )}
        {editing && (
          <div className="ml-auto flex items-center gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={cancel} disabled={saving}>Cancel</Button>
            <Button type="button" size="sm" variant={deltas.length ? "destructive" : "default"} onClick={onSaveClick} disabled={saving}>
              {deltas.length ? `Save with ${deltas.length} changed golden${deltas.length === 1 ? "" : "s"}` : "Save"}
            </Button>
          </div>
        )}
      </div>

      {err && <div className="rounded border border-destructive/40 bg-destructive/5 p-2 text-sm text-destructive">{err}</div>}

      {/* PREVIEW GATE (edit mode only) */}
      {editing && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Preview gate -- goldens computed against this draft</CardTitle></CardHeader>
          <CardContent>
            {allChecks.length === 0 ? (
              <p className="text-xs text-muted-foreground">No goldens stored on this config -- nothing to check.</p>
            ) : (
              <table className="w-full text-xs">
                <thead><tr className="text-left text-muted-foreground"><th className="py-1 pr-2">golden</th><th className="py-1 pr-2">pipeline.key</th><th className="py-1 pr-2 text-right">expected</th><th className="py-1 pr-2 text-right">draft</th><th className="py-1">status</th></tr></thead>
                <tbody>
                  {allChecks.map((c, i) => (
                    <tr key={i} className={c.pass ? "" : "text-destructive"}>
                      <td className="py-1 pr-2 align-top font-mono">{c.goldenId ?? `#${c.goldenIndex + 1}`}</td>
                      <td className="py-1 pr-2 align-top font-mono">{c.pipelineId}.{c.key}</td>
                      <td className="py-1 pr-2 text-right tabular-nums">{c.expected}</td>
                      <td className="py-1 pr-2 text-right tabular-nums">{c.got === null ? "-" : c.got}</td>
                      <td className="py-1">{c.pass ? <Badge variant="secondary">green</Badge> : <Badge variant="destructive">changed</Badge>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      )}

      {/* ATTRIBUTE DEFINITIONS */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Attribute definitions</CardTitle></CardHeader>
        <CardContent>
          {!editing ? (
            <table className="w-full text-xs">
              <thead><tr className="text-left text-muted-foreground"><th className="py-1 pr-3">id</th><th className="py-1 pr-3">label</th><th className="py-1 pr-3">type</th><th className="py-1 pr-3">values</th><th className="py-1">selectable</th></tr></thead>
              <tbody>
                {view.attribute_definitions.map((d) => (
                  <tr key={d.id}><td className="py-1 pr-3 font-mono">{d.id}</td><td className="py-1 pr-3">{d.label}</td><td className="py-1 pr-3">{d.type}</td><td className="py-1 pr-3">{(d.values ?? []).join(", ")}</td><td className="py-1">{d.selector === false ? "no" : "yes"}</td></tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="space-y-2">
              {view.attribute_definitions.map((d, di) => {
                const referenced = refIds.has(d.id);
                return (
                  <div key={di} className="flex flex-wrap items-center gap-1.5 rounded border p-1.5 text-xs">
                    <Input className="h-6 w-28 font-mono text-xs" value={d.id} aria-label="attribute id" onChange={(e) => updateDraft((dd) => { dd.attribute_definitions[di].id = e.target.value; })} />
                    <Input className="h-6 w-32 text-xs" value={d.label} aria-label="attribute label" onChange={(e) => updateDraft((dd) => { dd.attribute_definitions[di].label = e.target.value; })} />
                    <Select value={d.type} onValueChange={(t) => updateDraft((dd) => { dd.attribute_definitions[di].type = t as "choice" | "number"; if (t === "choice" && !dd.attribute_definitions[di].values) dd.attribute_definitions[di].values = []; })}>
                      <SelectTrigger className="h-6 w-24 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="choice">choice</SelectItem><SelectItem value="number">number</SelectItem></SelectContent>
                    </Select>
                    {d.type === "choice" && (
                      <Input className="h-6 w-48 text-xs" placeholder="comma,separated,values" aria-label="values" value={(d.values ?? []).join(",")} onChange={(e) => updateDraft((dd) => { dd.attribute_definitions[di].values = e.target.value.split(",").map((s) => s.trim()).filter(Boolean); })} />
                    )}
                    <label className="flex items-center gap-1"><Checkbox checked={d.selector !== false} onCheckedChange={(v) => updateDraft((dd) => { dd.attribute_definitions[di].selector = v === true ? undefined : false; })} aria-label="selectable" /> selectable</label>
                    <button type="button" aria-label={`remove ${d.id}`} disabled={referenced} title={referenced ? "referenced by a pipeline -- remove the references first" : "remove"} onClick={() => updateDraft((dd) => { dd.attribute_definitions.splice(di, 1); })} className="ml-auto text-muted-foreground hover:text-destructive disabled:opacity-30">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                    {referenced && <span className="text-[10px] text-muted-foreground">referenced</span>}
                  </div>
                );
              })}
              <div className="flex gap-2">
                <Button type="button" size="sm" variant="ghost" className="h-6 px-1 text-xs" onClick={() => updateDraft((dd) => { dd.attribute_definitions.push(blankAttributeDefinition("choice")); })}><Plus className="mr-1 h-3 w-3" /> choice attribute</Button>
                <Button type="button" size="sm" variant="ghost" className="h-6 px-1 text-xs" onClick={() => updateDraft((dd) => { dd.attribute_definitions.push(blankAttributeDefinition("number")); })}><Plus className="mr-1 h-3 w-3" /> number attribute</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* PIPELINES */}
      <div className="grid gap-4 md:grid-cols-2">
        {Object.entries(view.pipelines).map(([pid, pl]) => (
          <Card key={pid}>
            <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><span className="font-mono">{pid}</span><span className="text-xs font-normal text-muted-foreground">-&gt; {pl.output.join(", ")}</span></CardTitle>{pl.note && <p className="text-xs text-muted-foreground">{pl.note}</p>}</CardHeader>
            <CardContent className="space-y-2">
              {!editing ? (
                <ol className="space-y-1 text-xs">
                  {pl.steps.map((s, i) => (
                    <li key={i} className="flex gap-2"><span className="font-mono text-muted-foreground">{i}.</span><span className="font-mono">{String((s as { step: string }).step)}</span><span className="text-muted-foreground">{readableStep(s as Record<string, unknown>)}</span></li>
                  ))}
                </ol>
              ) : (
                <div className="space-y-2">
                  {pl.steps.map((s, i) => (
                    <StepEditor
                      key={i}
                      step={s as Record<string, unknown>}
                      index={i}
                      total={pl.steps.length}
                      attrDefs={view.attribute_definitions}
                      onPatch={(patch) => updateDraft((dd) => { const st = dd.pipelines[pid].steps[i] as Record<string, unknown>; const p = patch.params ? { params: { ...(st.params as object), ...(patch.params as object) } } : {}; Object.assign(st, patch, p); })}
                      onMove={(dir) => updateDraft((dd) => { const arr = dd.pipelines[pid].steps; const j = i + dir; if (j < 0 || j >= arr.length) return; [arr[i], arr[j]] = [arr[j], arr[i]]; })}
                      onRemove={() => updateDraft((dd) => { dd.pipelines[pid].steps.splice(i, 1); })}
                    />
                  ))}
                  <AddStep onAdd={(t) => updateDraft((dd) => { dd.pipelines[pid].steps.push(blankStep(t)); })} />
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* GOLDENS (read-only reference) */}
      {Array.isArray(view.goldens) && view.goldens.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Goldens (standing reference -- the preview gate checks these)</CardTitle></CardHeader>
          <CardContent>
            <table className="w-full text-xs">
              <thead><tr className="text-left text-muted-foreground"><th className="py-1 pr-3">attributes</th><th className="py-1">expected finals</th></tr></thead>
              <tbody>
                {(view.goldens as { attrs: Record<string, string | number>; expect: Record<string, Record<string, number>> }[]).map((g, i) => (
                  <tr key={i}>
                    <td className="py-1 pr-3 font-mono">{Object.entries(g.attrs).map(([k, v]) => `${k}=${v}`).join(", ")}</td>
                    <td className="py-1 font-mono">{Object.entries(g.expect).map(([pid, m]) => `${pid}: ${Object.entries(m).map(([k, v]) => `${k}=${v}`).join(", ")}`).join("  |  ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Save changes {deltas.length} golden{deltas.length === 1 ? "" : "s"} will change?</AlertDialogTitle>
            <AlertDialogDescription>These stored goldens compute a different value under this draft. Saving is allowed -- confirm the change is intended.</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="max-h-56 overflow-y-auto rounded border p-2 text-xs">
            {deltas.map((d, i) => (
              <div key={i} className="flex justify-between gap-2 font-mono"><span>{(d.goldenId ?? `#${d.goldenIndex + 1}`)} {d.pipelineId}.{d.key}</span><span>{d.expected} -&gt; {d.got === null ? "not produced" : d.got}</span></div>
            ))}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); void doSave(); }} disabled={saving}>Save with {deltas.length} changed</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function AddStep({ onAdd }: { onAdd: (t: StepType) => void }) {
  const [type, setType] = useState<StepType>(STEP_VOCABULARY[0]);
  return (
    <div className="flex items-center gap-2 pt-1">
      <Select value={type} onValueChange={(t) => setType(t as StepType)}>
        <SelectTrigger className="h-7 w-52 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>{STEP_VOCABULARY.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
      </Select>
      <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => onAdd(type)}><Plus className="mr-1 h-3 w-3" /> add step</Button>
    </div>
  );
}
