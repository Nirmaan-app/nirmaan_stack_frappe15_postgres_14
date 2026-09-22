// The handover documents whose text comes from the HOD library (per system, edited in Desk):
// O&M Manual, Do's & Don'ts, Maintenance Checklist, Recommended Tools, Equipment Warranty,
// Completion Certificate. The project stores only its choices: which parts are included, the
// values of the O&M [blanks], and the dates / names these certificates need.

import * as React from "react";

import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatDate } from "@/utils/FormatDate";

import { asString, asStringList, dlpEnd } from "../hodRules";
import type { HodLibraryBlock } from "../types";
import type { FormProps } from "./TableForms";

// ------------------------------------------------------------ O&M / Do's & Don'ts / Maintenance

export const LibraryForm: React.FC<
  FormProps & {
    blocks: HodLibraryBlock[];
    defaultIncluded: string[];
    withBlanks: boolean;
    listLabels: [string, string];
  }
> = ({
  value,
  onChange,
  readOnly,
  blocks,
  defaultIncluded,
  withBlanks,
  listLabels,
}) => {
  const multi = blocks.length > 1;
  const included = asStringList(value.included) ?? defaultIncluded;
  const picked = multi
    ? blocks.filter((b) => included.includes(b.sub_system || "all"))
    : blocks;
  const blankValues = (
    value.blanks && typeof value.blanks === "object" ? value.blanks : {}
  ) as Record<string, string>;
  const blanks = Array.from(new Set(picked.flatMap((b) => b.blanks)));

  if (!blocks.length) {
    return (
      <p className="rounded-md border border-dashed px-4 py-6 text-center text-sm text-gray-500">
        The library has no text for this document yet. It is added in Desk under
        HOD Library Content.
      </p>
    );
  }

  const toggle = (sub: string, on: boolean) => {
    const next = on
      ? Array.from(new Set([...included, sub]))
      : included.filter((s) => s !== sub);
    onChange({ ...value, included: next });
  };

  return (
    <div className="space-y-4">
      {multi && (
        <div className="rounded-md border bg-gray-50/60 p-3">
          <p className="mb-2 text-sm font-semibold text-gray-700">
            Parts handed over on this project
          </p>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {blocks.map((b) => {
              const sub = b.sub_system || "all";
              return (
                <label key={b.name} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={included.includes(sub)}
                    disabled={readOnly}
                    onCheckedChange={(c) => toggle(sub, c === true)}
                  />
                  {b.sub_system || b.title}
                </label>
              );
            })}
          </div>
          {value.included === undefined && (
            <p className="mt-2 text-xs text-gray-500">
              Pre-ticked from this project&apos;s Commission Report categories.
            </p>
          )}
        </div>
      )}

      {withBlanks && blanks.length > 0 && (
        <div className="rounded-md border p-3">
          <p className="mb-2 text-sm font-semibold text-gray-700">
            Fill in the blanks
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {blanks.map((name) => (
              <div key={name} className="space-y-1">
                <Label className="text-xs text-gray-600">{name}</Label>
                <Input
                  className="h-9"
                  value={asString(blankValues[name])}
                  disabled={readOnly}
                  onChange={(e) =>
                    onChange({
                      ...value,
                      blanks: { ...blankValues, [name]: e.target.value },
                    })
                  }
                />
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-gray-500">
            A blank left empty prints as written, e.g. [{blanks[0]}].
          </p>
        </div>
      )}

      <div className="space-y-3">
        {picked.map((b) => (
          <details
            key={b.name}
            className="rounded-md border"
            open={picked.length === 1}
          >
            <summary className="cursor-pointer select-none px-3 py-2 text-sm font-semibold text-gray-800">
              {b.title}
            </summary>
            <div className="max-h-80 overflow-y-auto border-t px-4 py-3 text-sm text-gray-700">
              {b.content ? (
                <div
                  className="[&_h4]:mb-1 [&_h4]:mt-3 [&_h4]:font-semibold [&_img]:my-2 [&_img]:max-w-full [&_li]:mb-0.5 [&_p]:my-1 [&_ul]:list-disc [&_ul]:pl-5"
                  // Library HTML is authored in Desk (a Text Editor field, sanitised by Frappe on save).
                  dangerouslySetInnerHTML={{ __html: b.content }}
                />
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  {[b.list_1, b.list_2].map((list, i) => (
                    <div key={i}>
                      <p className="mb-1 font-semibold">{listLabels[i]}</p>
                      <ol className="list-decimal space-y-1 pl-5">
                        {list.map((x, j) => (
                          <li key={j}>{x}</li>
                        ))}
                      </ol>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </details>
        ))}
        {multi && picked.length === 0 && (
          <p className="text-sm text-amber-700">
            No part is ticked — the document would print empty.
          </p>
        )}
      </div>
    </div>
  );
};

// ------------------------------------------------------------------------ Recommended Tools

export const ToolsView: React.FC<{ tools: string[] }> = ({ tools }) =>
  tools.length ? (
    <ol className="list-decimal space-y-1 rounded-md border px-8 py-3 text-sm text-gray-700">
      {tools.map((t, i) => (
        <li key={i}>{t}</li>
      ))}
    </ol>
  ) : (
    <p className="rounded-md border border-dashed px-4 py-6 text-center text-sm text-gray-500">
      No tools are listed for this system. They are added in Desk on the HOD
      System.
    </p>
  );

// ------------------------------------------------------------------------ Equipment Warranty

export const WarrantyForm: React.FC<
  FormProps & { defaultEquipment: string[] }
> = ({ value, onChange, readOnly, defaultEquipment }) => {
  const equipment = asStringList(value.equipment) ?? defaultEquipment;
  return (
    <div className="space-y-4">
      <div className="max-w-xs space-y-1">
        <Label className="text-xs text-gray-600">Commissioning date</Label>
        <Input
          type="date"
          className="h-9"
          value={asString(value.commissioning_date)}
          disabled={readOnly}
          onChange={(e) =>
            onChange({ ...value, commissioning_date: e.target.value })
          }
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs text-gray-600">
          Equipment installed (one per line)
        </Label>
        <Textarea
          rows={Math.min(12, Math.max(4, equipment.length + 1))}
          value={equipment.join("\n")}
          disabled={readOnly}
          onChange={(e) =>
            onChange({ ...value, equipment: e.target.value.split("\n") })
          }
        />
      </div>
      <p className="text-xs text-gray-500">
        The escalation contacts printed on the certificate come from this
        system&apos;s Escalation Chart.
      </p>
    </div>
  );
};

// ---------------------------------------------------------------------- Completion Certificate

export const CompletionForm: React.FC<
  FormProps & { customerName: string; warrantyDate: string }
> = ({ value, onChange, readOnly, customerName, warrantyDate }) => {
  const start = asString(value.commissioning_date) || warrantyDate;
  const end = dlpEnd(start);
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs text-gray-600">Commissioning date</Label>
          <Input
            type="date"
            className="h-9"
            value={start}
            disabled={readOnly}
            onChange={(e) =>
              onChange({ ...value, commissioning_date: e.target.value })
            }
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-gray-600">
            Handed over to (client)
          </Label>
          <Input
            className="h-9"
            placeholder={customerName || "Client"}
            value={
              value.handed_over_to === undefined
                ? customerName
                : asString(value.handed_over_to)
            }
            disabled={readOnly}
            onChange={(e) =>
              onChange({ ...value, handed_over_to: e.target.value })
            }
          />
        </div>
      </div>
      <p className="rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-700">
        Defects Liability Period:{" "}
        {start ? (
          <span className="font-medium">
            {formatDate(start)} to {formatDate(end)}
          </span>
        ) : (
          <span className="text-gray-500">set the commissioning date</span>
        )}
      </p>
    </div>
  );
};
