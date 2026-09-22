// The typed-in handover documents: Escalation Chart, Attic Stock List, Key List, Inventory List.
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
  asStringList,
  inventoryTotals,
} from "../hodRules";
import type {
  AtticRow,
  EscalationLevel,
  InventoryLocation,
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

const LEVELS = ["1st Level", "2nd Level", "3rd Level"];
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
  const levels = asObjectList<EscalationLevel>(value.levels);
  const setField = (i: number, field: keyof EscalationLevel, v: string) => {
    const next = LEVELS.map((_, j) => ({ ...(levels[j] || {}) }));
    next[i][field] = v;
    onChange({ ...value, levels: next });
  };
  return (
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
          </tr>
        </thead>
        <tbody>
          {LEVELS.map((label, i) => (
            <tr key={label} className="border-b last:border-b-0">
              <td className="px-2 py-1 text-sm font-medium text-gray-700">
                {label}
              </td>
              {LEVEL_FIELDS.map(([field]) => (
                <td key={field} className="px-1 py-1">
                  <Input
                    className={cell}
                    value={asString(levels[i]?.[field])}
                    disabled={readOnly}
                    onChange={(e) => setField(i, field, e.target.value)}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
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
  const shown =
    rows.length >= minRows || readOnly
      ? rows
      : [
          ...rows,
          ...Array.from({ length: minRows - rows.length }, () => ({}) as T),
        ];
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

// ------------------------------------------------------------------------- Inventory List

export const InventoryForm: React.FC<FormProps> = ({
  value,
  onChange,
  readOnly,
}) => {
  const materials = asStringList(value.materials) ?? [
    "Material",
    "Material",
    "Material",
  ];
  const locations = asObjectList<InventoryLocation>(value.locations);
  const totals = inventoryTotals(locations, materials.length);

  const setMaterials = (next: string[]) =>
    onChange({
      ...value,
      materials: next,
      locations: locations.map((l) => ({
        ...l,
        qty: next.map((_, j) => l.qty?.[j] ?? ""),
      })),
    });
  const setLocations = (next: InventoryLocation[]) =>
    onChange({ ...value, materials, locations: next });
  const setQty = (i: number, j: number, v: string) =>
    setLocations(
      locations.map((l, k) =>
        k === i
          ? {
              ...l,
              qty: materials.map((_, m) => (m === j ? v : (l.qty?.[m] ?? ""))),
            }
          : l,
      ),
    );

  return (
    <div className="space-y-2">
      <p className="text-xs text-gray-500">
        Columns are the materials, rows are the locations. The PDF prints
        landscape and adds a total per material.
      </p>
      <div className="overflow-x-auto rounded-md border">
        <table
          className="w-full border-collapse"
          style={{ minWidth: 260 + materials.length * 120 }}
        >
          <thead>
            <tr>
              <th className={`${th} w-12 text-center`}>S No</th>
              <th className={`${th} w-56`}>Location</th>
              {materials.map((m, j) => (
                <th key={j} className={`${th} min-w-[110px]`}>
                  <div className="flex items-center gap-1">
                    <Input
                      className={`${cell} font-semibold`}
                      value={m}
                      disabled={readOnly}
                      onChange={(e) =>
                        setMaterials(
                          materials.map((x, k) =>
                            k === j ? e.target.value : x,
                          ),
                        )
                      }
                    />
                    {!readOnly && materials.length > 1 && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0 text-gray-400 hover:text-red-600"
                        title="Remove column"
                        onClick={() =>
                          onChange({
                            ...value,
                            materials: materials.filter((_, k) => k !== j),
                            locations: locations.map((l) => ({
                              ...l,
                              qty: (l.qty || []).filter((_, k) => k !== j),
                            })),
                          })
                        }
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </th>
              ))}
              {!readOnly && <th className={`${th} w-10`} />}
            </tr>
          </thead>
          <tbody>
            {locations.map((l, i) => (
              <tr key={i} className="border-b">
                <td className="px-2 py-1 text-center text-sm text-gray-500">
                  {i + 1}
                </td>
                <td className="px-1 py-1">
                  <Input
                    className={cell}
                    value={asString(l.name)}
                    disabled={readOnly}
                    onChange={(e) =>
                      setLocations(
                        locations.map((x, k) =>
                          k === i ? { ...x, name: e.target.value } : x,
                        ),
                      )
                    }
                  />
                </td>
                {materials.map((_, j) => (
                  <td key={j} className="px-1 py-1">
                    <Input
                      className={`${cell} text-center`}
                      inputMode="decimal"
                      value={asString(l.qty?.[j])}
                      disabled={readOnly}
                      onChange={(e) => setQty(i, j, e.target.value)}
                    />
                  </td>
                ))}
                {!readOnly && (
                  <td className="px-1 py-1 text-center">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-gray-400 hover:text-red-600"
                      title="Remove location"
                      onClick={() =>
                        setLocations(locations.filter((_, k) => k !== i))
                      }
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </td>
                )}
              </tr>
            ))}
            {locations.length > 0 && (
              <tr className="bg-gray-50">
                <td />
                <td className="px-2 py-1.5 text-right text-sm font-semibold">
                  Total
                </td>
                {totals.map((t, j) => (
                  <td
                    key={j}
                    className="px-2 py-1.5 text-center text-sm font-semibold"
                  >
                    {t}
                  </td>
                ))}
                {!readOnly && <td />}
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {!readOnly && (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() =>
              setLocations([
                ...locations,
                { name: "", qty: materials.map(() => "") },
              ])
            }
          >
            <Plus className="mr-1 h-3.5 w-3.5" /> Add location
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() => setMaterials([...materials, "Material"])}
          >
            <Plus className="mr-1 h-3.5 w-3.5" /> Add material
          </Button>
        </div>
      )}
    </div>
  );
};
