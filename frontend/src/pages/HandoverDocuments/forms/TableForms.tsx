// The typed-in handover documents: Escalation Chart, Attic Stock List, Key List (the Inventory List has
// its own file, `InventoryForm.tsx`).
// Each is a controlled editor over the row's `form_data` (shapes in ../types.ts, read by
// api/hod/print_context.py). Saving is the dialog's job.

import { Plus, Trash2 } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import {
  asObjectList,
  asString,
  DEFAULT_ESCALATION_LEVELS,
  levelLabel,
  visibleRows,
} from "../hodRules";
import type {
  AtticRow,
  EscalationLevel,
  KeyReceiver,
  KeyRow,
} from "../types";

export interface FormProps {
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  readOnly: boolean;
}

const cell = "h-8 rounded-sm border-gray-200 px-2 text-sm";
const th =
  "border-b bg-gray-50 px-2 py-1.5 text-left text-xs font-semibold text-gray-600";

// ------------------------------------------------------------------------- Escalation Chart
//
// The number of levels is the project's own: three to start with, "Add level" for a fourth when the
// client needs one. The label is the row's position, so nothing has to be typed (services/hod/escalation).

const LEVEL_FIELDS: Array<[keyof EscalationLevel, string]> = [
  ["name", "Contact person"],
  ["designation", "Designation"],
  ["phone", "Contact info."],
  ["email", "Email address"],
];

export const EscalationForm: React.FC<FormProps> = ({
  value,
  onChange,
  readOnly,
}) => {
  const saved = asObjectList<EscalationLevel>(value.levels);
  const count = Math.max(saved.length, DEFAULT_ESCALATION_LEVELS);
  const rows = Array.from({ length: count }, (_, i) => saved[i] || {});

  const write = (next: EscalationLevel[]) =>
    onChange({ ...value, levels: next });

  const setField = (i: number, field: keyof EscalationLevel, v: string) => {
    const next = rows.map((r) => ({ ...r }));
    next[i][field] = v;
    write(next);
  };

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full min-w-[640px] border-collapse">
          <thead>
            <tr>
              <th className={`${th} w-24`}>Escalation</th>
              {LEVEL_FIELDS.map(([, label]) => (
                <th key={label} className={th}>
                  {label}
                </th>
              ))}
              {!readOnly && <th className={`${th} w-10`} />}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-b last:border-b-0">
                <td className="px-2 py-1 text-sm font-medium text-gray-700">
                  {levelLabel(i)}
                </td>
                {LEVEL_FIELDS.map(([field]) => (
                  <td key={field} className="px-1 py-1">
                    <Input
                      className={cell}
                      value={asString(row[field])}
                      disabled={readOnly}
                      onChange={(e) => setField(i, field, e.target.value)}
                    />
                  </td>
                ))}
                {!readOnly && (
                  <td className="px-1 py-1 text-center">
                    {/* The first three are the standard sheet; only the extra ones can be removed. */}
                    {i >= DEFAULT_ESCALATION_LEVELS && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-gray-400 hover:text-red-600"
                        title={`Remove ${levelLabel(i)}`}
                        onClick={() => write(rows.filter((_, j) => j !== i))}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!readOnly && (
        <Button
          variant="outline"
          size="sm"
          className="h-8"
          onClick={() => write([...rows, {}])}
        >
          <Plus className="mr-1 h-3.5 w-3.5" /> Add level
        </Button>
      )}
      <p className="text-[11px] text-gray-500">
        Three levels print by default; an added level prints as a further row on
        the chart and on the warranty certificate.
      </p>
    </div>
  );
};

// ------------------------------------------------------------------ Attic Stock / Key List

interface Column<T> {
  field: keyof T & string;
  label: string;
  width?: string;
}

function RowsTable<T extends object>({
  rows,
  columns,
  onRows,
  readOnly,
  minRows = 5,
}: {
  rows: T[];
  columns: Column<T>[];
  onRows: (rows: T[]) => void;
  readOnly: boolean;
  minRows?: number;
}) {
  const shown = visibleRows(rows, minRows, readOnly);
  const set = (i: number, field: keyof T, v: string) => {
    const next = shown.map((r) => ({ ...r }));
    (next[i] as Record<string, unknown>)[field as string] = v;
    onRows(next);
  };
  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full min-w-[560px] border-collapse">
          <thead>
            <tr>
              <th className={`${th} w-12 text-center`}>S No</th>
              {columns.map((c) => (
                <th
                  key={c.field}
                  className={th}
                  style={c.width ? { width: c.width } : undefined}
                >
                  {c.label}
                </th>
              ))}
              {!readOnly && <th className={`${th} w-10`} />}
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr>
                <td
                  colSpan={columns.length + 2}
                  className="px-3 py-4 text-center text-sm text-gray-400"
                >
                  Nothing entered — the printed sheet has blank rows to fill by
                  hand.
                </td>
              </tr>
            )}
            {shown.map((r, i) => (
              <tr key={i} className="border-b last:border-b-0">
                <td className="px-2 py-1 text-center text-sm text-gray-500">
                  {i + 1}
                </td>
                {columns.map((c) => (
                  <td key={c.field} className="px-1 py-1">
                    <Input
                      className={cell}
                      value={asString((r as Record<string, unknown>)[c.field])}
                      disabled={readOnly}
                      onChange={(e) => set(i, c.field, e.target.value)}
                    />
                  </td>
                ))}
                {!readOnly && (
                  <td className="px-1 py-1 text-center">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-gray-400 hover:text-red-600"
                      title="Remove row"
                      onClick={() => onRows(shown.filter((_, j) => j !== i))}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!readOnly && (
        <Button
          variant="outline"
          size="sm"
          className="h-8"
          onClick={() => onRows([...shown, {} as T])}
        >
          <Plus className="mr-1 h-3.5 w-3.5" /> Add row
        </Button>
      )}
    </div>
  );
}

const ATTIC_COLUMNS: Column<AtticRow>[] = [
  { field: "material", label: "Material" },
  { field: "make", label: "Make", width: "20%" },
  { field: "qty", label: "Qty (in Nos)", width: "14%" },
  { field: "remarks", label: "Remarks", width: "24%" },
];

export const AtticForm: React.FC<FormProps> = ({
  value,
  onChange,
  readOnly,
}) => (
  <RowsTable<AtticRow>
    rows={asObjectList<AtticRow>(value.rows)}
    columns={ATTIC_COLUMNS}
    readOnly={readOnly}
    onRows={(rows) => onChange({ ...value, rows })}
  />
);

const KEY_COLUMNS: Column<KeyRow>[] = [
  { field: "description", label: "Description" },
  { field: "key_no", label: "Key No.", width: "18%" },
  { field: "qty", label: "Qty (in Nos)", width: "14%" },
  { field: "remarks", label: "Remarks", width: "22%" },
];

const RECEIVER_FIELDS: Array<[keyof KeyReceiver, string, string]> = [
  ["name", "Name", "text"],
  ["designation", "Designation", "text"],
  ["phone", "Contact number", "text"],
  ["date", "Date", "date"],
];

export const KeyListForm: React.FC<FormProps & { customerName: string }> = ({
  value,
  onChange,
  readOnly,
  customerName,
}) => {
  const receiver = (
    value.receiver && typeof value.receiver === "object" ? value.receiver : {}
  ) as KeyReceiver;
  return (
    <div className="space-y-4">
      <RowsTable<KeyRow>
        rows={asObjectList<KeyRow>(value.rows)}
        columns={KEY_COLUMNS}
        readOnly={readOnly}
        onRows={(rows) => onChange({ ...value, rows })}
      />
      <div>
        <p className="mb-2 text-sm font-semibold text-gray-700">
          Details of the person the keys are handed over to
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {RECEIVER_FIELDS.map(([field, label, type]) => (
            <div key={field} className="space-y-1">
              <Label className="text-xs text-gray-600">{label}</Label>
              <Input
                type={type}
                className="h-9"
                value={asString(receiver[field])}
                disabled={readOnly}
                onChange={(e) =>
                  onChange({
                    ...value,
                    receiver: { ...receiver, [field]: e.target.value },
                  })
                }
              />
            </div>
          ))}
          <div className="space-y-1 sm:col-span-2">
            <Label className="text-xs text-gray-600">The keys belong to</Label>
            <Input
              className="h-9"
              placeholder={customerName || "Client company"}
              value={
                value.belongs_to === undefined
                  ? customerName
                  : asString(value.belongs_to)
              }
              disabled={readOnly}
              onChange={(e) =>
                onChange({ ...value, belongs_to: e.target.value })
              }
            />
          </div>
        </div>
      </div>
    </div>
  );
};
