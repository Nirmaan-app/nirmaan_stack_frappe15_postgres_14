import { useCallback, useMemo, useState } from "react";
import { useFrappeGetCall, useFrappePostCall } from "frappe-react-sdk";
import { ArrowDownToLine, ArrowUpToLine, Loader2, Pencil, Search, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getFrappeError } from "@/utils/frappeErrors";
import { ClassificationPill, CLS_LABELS } from "./reviewRender";
import { fuzzyDescriptionMatchSet } from "./boqDescriptionSearch";

// ── Constants ─────────────────────────────────────────────────────────────────
// Tree indent mirrors ReviewTree.tsx's INDENT_PX idiom (imitated, not imported).
const INDENT_PX = 20;
// parent_index sentinel: -1 = root (0 is a valid row_index). See template_edit.py.
const ROOT_PARENT = -1;
// Radix Select cannot use "" as an item value -> a distinct sentinel for the root option.
const ROOT_SENTINEL = "__root__";

// The 4 ASSIGNABLE classifications the editor may set (backend _ASSIGNABLE_CLASSIFICATIONS).
const ASSIGNABLE_CLASSIFICATIONS = [
  "line_item",
  "preamble",
  "note",
  "spacer",
] as const;
type AssignableClassification = (typeof ASSIGNABLE_CLASSIFICATIONS)[number];

const CLASSIFICATION_OPTIONS: { value: AssignableClassification; label: string }[] = [
  { value: "line_item", label: "Item" },
  { value: "preamble", label: "Preamble" },
  { value: "note", label: "Note" },
  { value: "spacer", label: "Spacer" },
];

function isAssignable(cls: string | null | undefined): cls is AssignableClassification {
  return !!cls && (ASSIGNABLE_CLASSIFICATIONS as readonly string[]).includes(cls);
}

// ── Row shape (template_edit.get_template_rows) ─────────────────────────────────
interface TemplateRow {
  name: string;
  row_index: number;
  classification: string | null;
  parent_index: number | null;
  attached_to_index: number | null;
  level: number | null;
  path: string | null;
  source_row_number: number | null;
  sl_no_value: string | null;
  description: string | null;
  unit: string | null;
  make_model: string | null;
  is_rate_only: 0 | 1;
}

interface GetTemplateRowsResponse {
  rows: TemplateRow[];
}

// ── Pure tree helpers (parent_index chain; -1 = root) ───────────────────────────

/**
 * depth = number of ancestors reachable via the parent_index chain. Root rows
 * (parent_index -1 or a dangling pointer) get depth 0. Cycle-guarded via `seen`.
 * Local walk (not reviewRender.computeDepths) because template rows use the -1 root
 * sentinel, not the effective_parent_index null convention computeDepths expects.
 */
function computeTemplateDepths(rows: TemplateRow[]): Map<number, number> {
  const parentOf = new Map<number, number>();
  for (const r of rows) parentOf.set(r.row_index, r.parent_index ?? ROOT_PARENT);
  const depths = new Map<number, number>();
  for (const r of rows) {
    let depth = 0;
    const seen = new Set<number>();
    let cur = r.parent_index ?? ROOT_PARENT;
    while (cur >= 0 && parentOf.has(cur) && !seen.has(cur)) {
      seen.add(cur);
      depth += 1;
      cur = parentOf.get(cur) ?? ROOT_PARENT;
    }
    depths.set(r.row_index, depth);
  }
  return depths;
}

/** Every row_index that is a (transitive) child of `rowIndex` via parent_index. */
function collectDescendants(rows: TemplateRow[], rowIndex: number): Set<number> {
  const childrenOf = new Map<number, number[]>();
  for (const r of rows) {
    const p = r.parent_index ?? ROOT_PARENT;
    if (p >= 0) {
      const arr = childrenOf.get(p) ?? [];
      arr.push(r.row_index);
      childrenOf.set(p, arr);
    }
  }
  const out = new Set<number>();
  const stack = [rowIndex];
  while (stack.length) {
    const cur = stack.pop() as number;
    for (const c of childrenOf.get(cur) ?? []) {
      if (!out.has(c)) {
        out.add(c);
        stack.push(c);
      }
    }
  }
  return out;
}

function clsLabel(cls: string | null | undefined): string {
  if (!cls) return "";
  return CLS_LABELS[cls] ?? cls;
}

// ── Form dialog state ──────────────────────────────────────────────────────────
type FormMode =
  | { kind: "create"; anchor: TemplateRow; position: "above" | "below" }
  | { kind: "edit"; row: TemplateRow };

interface RowFormState {
  classification: string;
  description: string;
  unit: string;
  make_model: string;
  /** ROOT_SENTINEL or String(row_index). */
  parent: string;
}

interface TemplateRowsEditorProps {
  template: string;
  /** Sheet name matched VERBATIM (#152) -- no trim in args / keys. */
  sheetName: string;
  canEdit: boolean;
}

/**
 * A-T8 -- the LEAN dedicated master-template row editor (owner chose a purpose-built
 * editor over reusing ReviewTree). Renders one sheet's BoQ Template Rows as an indented
 * tree (depth from the parent_index chain) and, when canEdit, exposes per-row
 * edit / insert-above / insert-below / delete against the template_edit.* endpoints.
 */
export function TemplateRowsEditor({ template, sheetName, canEdit }: TemplateRowsEditorProps) {
  const swrKey =
    template && sheetName ? `tpl-rows::${template}::${sheetName}` : null;

  const { data, isLoading, error, mutate } = useFrappeGetCall<{
    message: GetTemplateRowsResponse;
  }>(
    "nirmaan_stack.api.boq.wizard.template_edit.get_template_rows",
    { template, sheet_name: sheetName },
    swrKey
  );

  const rows = useMemo(() => data?.message?.rows ?? [], [data]);
  // Depths compute over the FULL rows (never the filtered set) so a matched row keeps
  // its correct indent even when its ancestors are filtered out by the search.
  const depths = useMemo(() => computeTemplateDepths(rows), [rows]);

  // 4c row search: FILTER-TO-MATCHES via the shared fuzzy matcher (token-AND, partial,
  // min length 2). Below the 2-char threshold the full row list shows.
  const [rowSearch, setRowSearch] = useState("");
  const isSearching = rowSearch.trim().length >= 2;
  const visibleRows = useMemo(() => {
    if (rowSearch.trim().length < 2) return rows;
    const matched = fuzzyDescriptionMatchSet(rows, rowSearch, (r) => r.description ?? "");
    return rows.filter((r) => matched.has(r));
  }, [rows, rowSearch]);

  // ── Mutations ────────────────────────────────────────────────────────────────
  const { call: createRow } = useFrappePostCall(
    "nirmaan_stack.api.boq.wizard.template_edit.template_create_row"
  );
  const { call: editRow } = useFrappePostCall(
    "nirmaan_stack.api.boq.wizard.template_edit.template_edit_row"
  );
  const { call: deleteRow } = useFrappePostCall(
    "nirmaan_stack.api.boq.wizard.template_edit.template_delete_row"
  );

  // ── Dialog + form state ──────────────────────────────────────────────────────
  const [formMode, setFormMode] = useState<FormMode | null>(null);
  const [form, setForm] = useState<RowFormState>({
    classification: "line_item",
    description: "",
    unit: "",
    make_model: "",
    parent: ROOT_SENTINEL,
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<TemplateRow | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const openCreate = useCallback(
    (anchor: TemplateRow, position: "above" | "below") => {
      const anchorParent =
        anchor.parent_index != null && anchor.parent_index >= 0
          ? String(anchor.parent_index)
          : ROOT_SENTINEL;
      setForm({
        classification: "line_item",
        description: "",
        unit: "",
        make_model: "",
        parent: anchorParent,
      });
      setFormError(null);
      setFormMode({ kind: "create", anchor, position });
    },
    []
  );

  const openEdit = useCallback((row: TemplateRow) => {
    setForm({
      classification: row.classification ?? "line_item",
      description: row.description ?? "",
      unit: row.unit ?? "",
      make_model: row.make_model ?? "",
      parent:
        row.parent_index != null && row.parent_index >= 0
          ? String(row.parent_index)
          : ROOT_SENTINEL,
    });
    setFormError(null);
    setFormMode({ kind: "edit", row });
  }, []);

  // Parent-picker choices: create = any row (pre-insert keyspace); edit = every row
  // except the row itself + its descendants (a cycle-safe subset; backend guards too).
  const parentChoices = useMemo(() => {
    if (!formMode) return rows;
    if (formMode.kind === "edit") {
      const desc = collectDescendants(rows, formMode.row.row_index);
      return rows.filter(
        (r) => r.row_index !== formMode.row.row_index && !desc.has(r.row_index)
      );
    }
    return rows;
  }, [rows, formMode]);

  // Classification options: the 4 assignable, plus (edit only) the row's current
  // NON-assignable class shown as a disabled item so the trigger renders a real value.
  const classificationChoices = useMemo(() => {
    const base = CLASSIFICATION_OPTIONS.map((o) => ({ ...o, disabled: false }));
    if (formMode?.kind === "edit") {
      const cur = formMode.row.classification;
      if (cur && !isAssignable(cur)) {
        base.unshift({
          value: cur as AssignableClassification,
          label: `${clsLabel(cur)} (current)`,
          disabled: true,
        });
      }
    }
    return base;
  }, [formMode]);

  const parentToNumber = useCallback(
    (): number =>
      form.parent === ROOT_SENTINEL ? ROOT_PARENT : parseInt(form.parent, 10),
    [form.parent]
  );

  const handleSubmit = useCallback(async () => {
    if (!formMode) return;
    setSaving(true);
    setFormError(null);
    try {
      const parentNum = parentToNumber();
      if (formMode.kind === "create") {
        await createRow({
          template,
          sheet_name: sheetName,
          anchor_row_index: formMode.anchor.row_index,
          position: formMode.position,
          classification: form.classification,
          parent_index: parentNum,
          description: form.description || undefined,
          unit: form.unit || undefined,
          make_model: form.make_model || undefined,
        });
      } else {
        const row = formMode.row;
        const payload: Record<string, unknown> = { row_name: row.name };
        if ((row.description ?? "") !== form.description)
          payload.description = form.description;
        if ((row.unit ?? "") !== form.unit) payload.unit = form.unit;
        if ((row.make_model ?? "") !== form.make_model)
          payload.make_model = form.make_model;
        if ((row.classification ?? "") !== form.classification)
          payload.classification = form.classification;
        const origParent =
          row.parent_index != null && row.parent_index >= 0
            ? row.parent_index
            : ROOT_PARENT;
        if (origParent !== parentNum) payload.parent_index = parentNum;
        await editRow(payload);
      }
      await mutate();
      setFormMode(null);
    } catch (e) {
      setFormError(getFrappeError(e));
    } finally {
      setSaving(false);
    }
  }, [
    formMode,
    parentToNumber,
    createRow,
    editRow,
    template,
    sheetName,
    form,
    mutate,
  ]);

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setSaving(true);
    setDeleteError(null);
    try {
      await deleteRow({
        template,
        sheet_name: sheetName,
        row_index: deleteTarget.row_index,
      });
      await mutate();
      setDeleteTarget(null);
    } catch (e) {
      setDeleteError(getFrappeError(e));
    } finally {
      setSaving(false);
    }
  }, [deleteTarget, deleteRow, template, sheetName, mutate]);

  // ── Render ───────────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading rows...
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
        <p className="font-medium text-destructive">Could not load rows</p>
        <p className="mt-1 text-muted-foreground">{getFrappeError(error)}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* 4c: row search lives ABOVE the empty/table branch so it persists when a query
          filters every row out (letting the user edit or clear the query). */}
      {rows.length > 0 && (
        <div className="flex items-center gap-2">
          <div className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={rowSearch}
              onChange={(e) => setRowSearch(e.target.value)}
              placeholder="Search rows by description…"
              className="h-8 pl-7 pr-7 text-xs"
              aria-label="Search rows by description"
            />
            {rowSearch !== "" && (
              <button
                type="button"
                onClick={() => setRowSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          {isSearching && (
            <span className="text-xs tabular-nums text-muted-foreground">
              {visibleRows.length} of {rows.length} rows
            </span>
          )}
        </div>
      )}

      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          This sheet has no rows yet.
        </p>
      ) : visibleRows.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No rows match “{rowSearch.trim()}”.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-14">#</TableHead>
                <TableHead className="w-24">Type</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="w-24">Unit</TableHead>
                <TableHead className="w-40">Make / Model</TableHead>
                {canEdit && <TableHead className="w-40 text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleRows.map((r) => {
                const depth = depths.get(r.row_index) ?? 0;
                return (
                  <TableRow key={r.name}>
                    <TableCell className="align-top tabular-nums text-muted-foreground">
                      {r.row_index}
                    </TableCell>
                    <TableCell className="align-top">
                      <ClassificationPill cls={r.classification} />
                    </TableCell>
                    <TableCell className="align-top">
                      <div style={{ paddingLeft: `${depth * INDENT_PX}px` }}>
                        <span className="text-sm text-foreground">
                          {r.description?.trim() || (
                            <span className="italic text-muted-foreground">
                              (no description)
                            </span>
                          )}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="align-top text-sm text-muted-foreground">
                      {r.unit?.trim() || "--"}
                    </TableCell>
                    <TableCell className="align-top text-sm text-muted-foreground">
                      {r.make_model?.trim() || "--"}
                    </TableCell>
                    {canEdit && (
                      <TableCell className="align-top">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2"
                            title="Insert row above"
                            onClick={() => openCreate(r, "above")}
                          >
                            <ArrowUpToLine className="h-3.5 w-3.5" />
                            <span className="sr-only">Insert above</span>
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2"
                            title="Insert row below"
                            onClick={() => openCreate(r, "below")}
                          >
                            <ArrowDownToLine className="h-3.5 w-3.5" />
                            <span className="sr-only">Insert below</span>
                          </Button>
                          <span
                            aria-hidden="true"
                            className="mx-0.5 h-4 w-px bg-border"
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2"
                            title="Edit row"
                            onClick={() => openEdit(r)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            <span className="sr-only">Edit</span>
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-destructive hover:text-destructive"
                            title="Delete row"
                            onClick={() => {
                              setDeleteError(null);
                              setDeleteTarget(r);
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            <span className="sr-only">Delete</span>
                          </Button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* ── Create / Edit dialog ──────────────────────────────────────────── */}
      <Dialog
        open={!!formMode}
        onOpenChange={(open) => {
          if (!open && !saving) setFormMode(null);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {formMode?.kind === "edit"
                ? `Edit row #${formMode.row.row_index}`
                : formMode
                ? `Insert row ${formMode.position} #${formMode.anchor.row_index}`
                : "Row"}
            </DialogTitle>
            <DialogDescription>
              {formMode?.kind === "edit"
                ? "Change this row's classification, content, or parent."
                : "A new row is inserted with renumber-on-insert; every following row shifts down."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="tpl-row-cls">Classification</Label>
              <Select
                value={form.classification}
                onValueChange={(v) => setForm((f) => ({ ...f, classification: v }))}
              >
                <SelectTrigger id="tpl-row-cls">
                  <SelectValue placeholder="Select a classification" />
                </SelectTrigger>
                <SelectContent>
                  {classificationChoices.map((o) => (
                    <SelectItem key={o.value} value={o.value} disabled={o.disabled}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="tpl-row-desc">Description</Label>
              <Textarea
                id="tpl-row-desc"
                rows={3}
                value={form.description}
                onChange={(e) =>
                  setForm((f) => ({ ...f, description: e.target.value }))
                }
                placeholder="Row description"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="tpl-row-unit">Unit</Label>
                <Input
                  id="tpl-row-unit"
                  value={form.unit}
                  onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))}
                  placeholder="e.g. Nos"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tpl-row-mm">Make / Model</Label>
                <Input
                  id="tpl-row-mm"
                  value={form.make_model}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, make_model: e.target.value }))
                  }
                  placeholder="optional"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="tpl-row-parent">Parent</Label>
              <Select
                value={form.parent}
                onValueChange={(v) => setForm((f) => ({ ...f, parent: v }))}
              >
                <SelectTrigger
                  id="tpl-row-parent"
                  className="h-auto min-h-9 items-start py-2 text-left [&>span]:line-clamp-none [&>span]:whitespace-normal [&>span]:break-words"
                >
                  <SelectValue placeholder="Select a parent" />
                </SelectTrigger>
                <SelectContent className="max-w-[var(--radix-select-trigger-width)]">
                  <SelectItem value={ROOT_SENTINEL}>Top level (root)</SelectItem>
                  {parentChoices.map((r) => (
                    <SelectItem
                      key={r.name}
                      value={String(r.row_index)}
                      className="items-start whitespace-normal break-words"
                    >
                      #{r.row_index} · {clsLabel(r.classification) || "—"} ·{" "}
                      {r.description?.trim() || "(no description)"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {formError && (
              <p className="text-sm text-destructive">{formError}</p>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={() => setFormMode(null)}
            >
              Cancel
            </Button>
            <Button type="button" disabled={saving} onClick={handleSubmit}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {formMode?.kind === "edit" ? "Save changes" : "Insert row"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete confirm ────────────────────────────────────────────────── */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open && !saving) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this row?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget ? (
                <>
                  Row #{deleteTarget.row_index}
                  {deleteTarget.description?.trim()
                    ? ` — "${deleteTarget.description.trim()}"`
                    : ""}{" "}
                  will be removed. Its children are re-parented to its parent and the
                  sheet is renumbered.
                </>
              ) : (
                ""
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError && (
            <p className="text-sm text-destructive">{deleteError}</p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={saving}
              onClick={(e) => {
                e.preventDefault();
                void handleDelete();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
