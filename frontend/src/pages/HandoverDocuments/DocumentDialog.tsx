// One handover document of one system, opened from its checklist row: the typed forms, the
// library-backed templates (part picks + blanks), or the read-only records of a from-app document.
// Saving writes the row's `form_data` only (update_row); nothing else is touched.

import { Loader2 } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/use-toast";
import { getFrappeError } from "@/utils/frappeErrors";

import {
  AtticForm,
  EscalationForm,
  InventoryForm,
  KeyListForm,
} from "./forms/TableForms";
import {
  CompletionForm,
  LibraryForm,
  ToolsForm,
  WarrantyForm,
} from "./forms/TemplateForms";
import { MaintenanceForm } from "./forms/MaintenanceForm";
import { SourcesView } from "./forms/SourcesView";
import { useSystemLibrary } from "./hodApi";
import {
  asObjectList,
  asString,
  compactMaintenanceChecks,
  compactRows,
  compactTextMap,
} from "./hodRules";
import type { HodDocumentMeta, HodRow } from "./types";

/** Documents whose header block prints a DATE the user may set (default: today). The Maintenance Checklist
 *  asks for the date of the check inside its own form (empty stays blank on paper); the Warranty prints its
 *  commissioning date instead. */
const DATED = new Set([
  "escalation_chart",
  "inventory_list",
  "attic_stock_list",
  "key_list",
]);
const LIST_LABELS: Record<string, [string, string]> = {
  dos_donts: ["Do's", "Don't"],
};

/** Tidy the draft before it is stored: drop empty grid rows, keep defaults the screen displayed. */
function finalize(
  key: string,
  draft: Record<string, unknown>,
  ctx: { warrantyDate: string },
): Record<string, unknown> {
  const out = { ...draft };
  if (key === "attic_stock_list" || key === "key_list")
    out.rows = compactRows(asObjectList(out.rows));
  if (key === "inventory_list") {
    out.locations = asObjectList<{ name?: string; qty?: unknown[] }>(
      out.locations,
    ).filter(
      (l) =>
        asString(l.name).trim() ||
        (l.qty || []).some((q) => asString(q).trim()),
    );
  }
  if (key === "equipment_warranty" && Array.isArray(out.equipment)) {
    out.equipment = (out.equipment as unknown[])
      .map(asString)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (key === "recommended_tools" && out.tool_remarks !== undefined) {
    out.tool_remarks = compactTextMap(out.tool_remarks);
  }
  if (key === "maintenance_checklist" && out.checks !== undefined) {
    out.checks = compactMaintenanceChecks(out.checks);
  }
  if (
    key === "completion_certificate" &&
    !asString(out.commissioning_date) &&
    ctx.warrantyDate
  ) {
    out.commissioning_date = ctx.warrantyDate;
  }
  return out;
}

export interface DocumentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  customerName: string;
  hodSystem: string;
  displayName: string;
  row: HodRow;
  meta: HodDocumentMeta;
  /** The other rows of this system (the completion certificate borrows the warranty's date). */
  siblings: HodRow[];
  readOnly: boolean;
  onSave: (formData: Record<string, unknown>) => Promise<void>;
  /** From Nirmaan documents: keep the ticked reports and download them. */
  onDownloadSelected: (selected: string[]) => Promise<void>;
}

export const DocumentDialog: React.FC<DocumentDialogProps> = ({
  open,
  onOpenChange,
  projectId,
  customerName,
  hodSystem,
  displayName,
  row,
  meta,
  siblings,
  readOnly,
  onSave,
  onDownloadSelected,
}) => {
  const [draft, setDraft] = React.useState<Record<string, unknown>>(
    row.form_data || {},
  );
  const [saving, setSaving] = React.useState(false);

  // Fresh draft every time the dialog opens (never carry an abandoned edit over).
  React.useEffect(() => {
    if (open) setDraft(row.form_data || {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const needsLibrary = meta.kind === "template";
  const { library, isLoading: libraryLoading } = useSystemLibrary(
    projectId,
    hodSystem,
    open && needsLibrary,
  );
  const warrantyDate = asString(
    siblings.find((r) => r.document === "equipment_warranty")?.form_data
      ?.commissioning_date,
  );

  const isFromApp = meta.kind === "app";
  const editable = !readOnly && !isFromApp;

  const save = async () => {
    setSaving(true);
    try {
      await onSave(finalize(meta.key, draft, { warrantyDate }));
      onOpenChange(false);
    } catch (error: any) {
      toast({
        title: "Could not save",
        description: getFrappeError(error),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const formProps = { value: draft, onChange: setDraft, readOnly: !editable };

  let body: React.ReactNode;
  if (isFromApp) {
    body = (
      <SourcesView
        projectId={projectId}
        hodSystem={hodSystem}
        meta={meta}
        row={row}
        canEdit={!readOnly}
        onDownloadSelected={onDownloadSelected}
      />
    );
  } else if (needsLibrary && (libraryLoading || !library)) {
    body = (
      <div className="flex items-center justify-center py-10 text-sm text-gray-500">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading the{" "}
        {displayName} library…
      </div>
    );
  } else {
    switch (meta.key) {
      case "escalation_chart":
        body = <EscalationForm {...formProps} />;
        break;
      case "attic_stock_list":
        body = <AtticForm {...formProps} />;
        break;
      case "key_list":
        body = <KeyListForm {...formProps} customerName={customerName} />;
        break;
      case "inventory_list":
        body = <InventoryForm {...formProps} />;
        break;
      case "recommended_tools":
        body = (
          <ToolsForm {...formProps} tools={library?.system.tools ?? []} />
        );
        break;
      case "equipment_warranty":
        body = (
          <WarrantyForm
            {...formProps}
            defaultEquipment={library?.system.warranty_equipment ?? []}
          />
        );
        break;
      case "completion_certificate":
        body = (
          <CompletionForm
            {...formProps}
            customerName={customerName}
            warrantyDate={warrantyDate}
          />
        );
        break;
      case "maintenance_checklist": {
        const lib = meta.library ?? "";
        body = (
          <MaintenanceForm
            {...formProps}
            blocks={library?.contents[lib] ?? []}
            defaultIncluded={library?.default_included[lib] ?? []}
          />
        );
        break;
      }
      default: {
        const lib = meta.library ?? "";
        body = (
          <LibraryForm
            {...formProps}
            blocks={library?.contents[lib] ?? []}
            defaultIncluded={library?.default_included[lib] ?? []}
            withBlanks={meta.key === "om_manual"}
            listLabels={LIST_LABELS[meta.key] ?? ["", ""]}
          />
        );
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {meta.no}. {meta.title}
          </DialogTitle>
          <DialogDescription>
            {displayName}
            {row.disabled ? " — switched off, so it is read-only." : ""}
          </DialogDescription>
        </DialogHeader>

        {DATED.has(meta.key) && (
          <div className="max-w-xs space-y-1">
            <Label className="text-xs text-gray-600">
              Date on the document
            </Label>
            <Input
              type="date"
              className="h-9"
              value={asString(draft.date)}
              disabled={!editable}
              onChange={(e) => setDraft({ ...draft, date: e.target.value })}
            />
            <p className="text-[11px] text-gray-500">
              Left empty, the PDF prints the day it is downloaded.
            </p>
          </div>
        )}

        {body}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            {editable ? "Cancel" : "Close"}
          </Button>
          {editable && (
            <Button onClick={save} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
