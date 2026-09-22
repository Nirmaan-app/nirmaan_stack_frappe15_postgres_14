// Maintenance Checklist (#7): the library's six-monthly and yearly check items for the ticked parts, with
// this project's Result + Remarks per item and Comments per sheet, plus the date of the check. Stored in
// `form_data` (`included`, `date`, `checks`); the PDF prints one sheet per part and period, as in the
// workbook, and anything left empty prints blank for writing by hand (services/hod/maintenance.py).

import * as React from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import {
  asString,
  asStringList,
  MAINTENANCE_PERIODS,
  MAINTENANCE_RESULTS,
  maintenanceSheet,
  withMaintenanceResult,
  withMaintenanceSheet,
} from "../hodRules";
import type { HodLibraryBlock } from "../types";
import type { FormProps } from "./TableForms";
import { NoLibraryText, PartTicks } from "./TemplateForms";

const th =
  "border-b bg-gray-50 px-2 py-1.5 text-left text-xs font-semibold text-gray-600";

export const MaintenanceForm: React.FC<
  FormProps & { blocks: HodLibraryBlock[]; defaultIncluded: string[] }
> = ({ value, onChange, readOnly, blocks, defaultIncluded }) => {
  if (!blocks.length) return <NoLibraryText />;

  const multi = blocks.length > 1;
  const included = asStringList(value.included) ?? defaultIncluded;
  const picked = multi
    ? blocks.filter((b) => included.includes(b.sub_system || "all"))
    : blocks;
  const sheets = picked.flatMap((b) =>
    MAINTENANCE_PERIODS.filter((p) => b[p.list].length).map((p) => ({
      block: b,
      ...p,
    })),
  );

  return (
    <div className="space-y-4">
      {multi && (
        <PartTicks
          value={value}
          onChange={onChange}
          readOnly={readOnly}
          blocks={blocks}
          included={included}
        />
      )}

      <div className="max-w-xs space-y-1">
        <Label className="text-xs text-gray-600">Date of the check</Label>
        <Input
          type="date"
          className="h-9"
          value={asString(value.date)}
          disabled={readOnly}
          onChange={(e) => onChange({ ...value, date: e.target.value })}
        />
        <p className="text-[11px] text-gray-500">
          Left empty, the DATE on the sheets stays blank to write by hand.
        </p>
      </div>

      {sheets.map(({ block, list, label }) => {
        const sheet = maintenanceSheet(value, block.name, list);
        const results = sheet.results ?? {};
        const items = block[list];
        const done = items.filter((x) => asString(results[x]?.result)).length;
        return (
          <details
            key={`${block.name}-${list}`}
            className="rounded-md border"
            open={sheets.length <= 2}
          >
            <summary className="flex cursor-pointer select-none items-center justify-between gap-3 px-3 py-2 text-sm font-semibold text-gray-800">
              <span>
                {block.title} — {label}
              </span>
              <span className="text-xs font-normal text-gray-500">
                {done} of {items.length} checked
              </span>
            </summary>
            <div className="space-y-3 border-t p-3">
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full min-w-[640px] border-collapse">
                  <thead>
                    <tr>
                      <th className={`${th} w-12 text-center`}>Sl.No</th>
                      <th className={th}>Description</th>
                      <th className={`${th} w-32`}>Result</th>
                      <th className={`${th} w-64`}>Remarks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item, i) => {
                      const check = results[item] ?? {};
                      const set = (patch: { result?: string; remarks?: string }) =>
                        onChange(
                          withMaintenanceResult(value, block.name, list, item, patch),
                        );
                      return (
                        <tr key={`${i}-${item}`} className="border-b last:border-b-0">
                          <td className="px-2 py-1 text-center text-sm text-gray-500">
                            {i + 1}
                          </td>
                          <td className="px-2 py-1 text-sm text-gray-700">{item}</td>
                          <td className="px-1 py-1">
                            {/* The blank option stays selectable so a result can be cleared. */}
                            <select
                              className="h-8 w-full rounded-sm border border-gray-200 bg-white px-1.5 text-sm disabled:opacity-60"
                              value={asString(check.result)}
                              disabled={readOnly}
                              onChange={(e) => set({ result: e.target.value })}
                            >
                              <option value="">—</option>
                              {MAINTENANCE_RESULTS.map((r) => (
                                <option key={r} value={r}>
                                  {r}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-1 py-1">
                            <Input
                              className="h-8 rounded-sm border-gray-200 px-2 text-sm"
                              value={asString(check.remarks)}
                              disabled={readOnly}
                              onChange={(e) => set({ remarks: e.target.value })}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-gray-600">Comments</Label>
                <Textarea
                  rows={2}
                  value={asString(sheet.comments)}
                  disabled={readOnly}
                  onChange={(e) =>
                    onChange(
                      withMaintenanceSheet(value, block.name, list, {
                        comments: e.target.value,
                      }),
                    )
                  }
                />
              </div>
            </div>
          </details>
        );
      })}

      {multi && picked.length === 0 && (
        <p className="text-sm text-amber-700">
          No part is ticked — the document would print empty.
        </p>
      )}
    </div>
  );
};
