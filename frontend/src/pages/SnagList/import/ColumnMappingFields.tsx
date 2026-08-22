/**
 * Snag import wizard -- the four column-mapping selects for ONE sheet.
 *
 * These are shadcn `Select` (Radix), NOT native `<select>`, so the controlled-select
 * placeholder trap in frontend/CLAUDE.md does not apply: Radix does not fall back to the
 * first selectable option when nothing matches -- it renders the placeholder. The
 * "(not mapped)" entry is still a REAL, selectable item (sentinel `MAPPING_NONE`, because
 * Radix reserves "" ), so a user can always clear a role by hand.
 *
 * OPTION LABELS ARE TRUNCATED (R3 change 2), because the header row is user-declarable: point
 * it at a DATA row and every "header" is a whole sentence. Only the header TEXT is clipped --
 * the column letter always renders in full, since it is the part that identifies the column --
 * and the full text is carried on each option's `title`, so nothing is lost, only folded away.
 *
 * That placeholder behaviour is also the hazard this file has to answer. When a stored letter
 * matches NO `SelectItem` -- reachable as soon as the header row is overridden and `columns`
 * is recomputed -- Radix shows "(not mapped)" while the mapping still HOLDS the letter and the
 * wire still sends it. So an unmatched letter is called out explicitly under the field, and
 * `isMappingValid` / `evaluateConfirmGate` refuse it rather than letting it through unseen.
 */

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import type { SnagColumnMapping, WorkbookColumn } from "../types";
import {
  MAPPING_NONE,
  columnOptionLabel,
  columnOptionTitle,
  isKnownColumn,
  optionalToSelect,
  selectToOptional,
  selectToRequired,
} from "./importState";

export interface ColumnMappingFieldsProps {
  sheetName: string;
  columns: WorkbookColumn[];
  mapping: SnagColumnMapping;
  onChange: (next: SnagColumnMapping) => void;
}

interface RoleSpec {
  key: keyof SnagColumnMapping;
  label: string;
  required: boolean;
}

const ROLES: RoleSpec[] = [
  { key: "area", label: "Area / Location", required: false },
  { key: "category", label: "Category", required: false },
  { key: "description", label: "Snag Description", required: true },
  { key: "remarks", label: "Remarks", required: false },
];

export function ColumnMappingFields({
  sheetName,
  columns,
  mapping,
  onChange,
}: ColumnMappingFieldsProps) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {ROLES.map((role) => {
        const current = mapping[role.key];
        const letter = current ? String(current) : null;
        const value = optionalToSelect(letter);
        const id = `snag-map-${sheetName}-${role.key}`;
        const missing = role.required && !current;
        // A letter left over from a previous header row: no matching item, so the trigger
        // silently renders the placeholder. Never let that pass as "(not mapped)".
        const unknown = !!letter && !isKnownColumn(columns, letter);
        const selected = letter ? columns.find((c) => c.letter === letter) : undefined;
        return (
          <div key={role.key} className="space-y-1.5">
            <Label htmlFor={id} className="text-xs">
              {role.label}
              {role.required && <span className="ml-0.5 text-destructive">*</span>}
            </Label>
            <Select
              value={value}
              onValueChange={(next) => {
                if (role.key === "description") {
                  onChange({ ...mapping, description: selectToRequired(next) });
                } else {
                  onChange({ ...mapping, [role.key]: selectToOptional(next) });
                }
              }}
            >
              <SelectTrigger
                id={id}
                // The trigger renders the TRUNCATED option text, so the full header stays one
                // hover away here too -- not only inside the open dropdown.
                title={selected ? columnOptionTitle(selected) : undefined}
                className={missing || unknown ? "border-destructive" : undefined}
              >
                <SelectValue placeholder="(not mapped)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={MAPPING_NONE}>
                  {role.required ? "(not mapped — required)" : "(not mapped)"}
                </SelectItem>
                {columns.map((col) => (
                  <SelectItem
                    key={col.letter}
                    value={col.letter}
                    title={columnOptionTitle(col)}
                  >
                    {columnOptionLabel(col)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {unknown && (
              <p className="text-xs text-destructive">
                Column {letter} is not in this sheet — pick one from the list.
              </p>
            )}
            {missing && !unknown && (
              <p className="text-xs text-destructive">
                Required — rows are detected from this column.
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
