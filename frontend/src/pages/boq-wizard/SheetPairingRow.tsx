import ReactSelect from "react-select";
import { Checkbox } from "@/components/ui/checkbox";
import { getSelectStyles } from "@/config/selectTheme";
import { cn } from "@/lib/utils";
import {
  NEW_SHEET,
  UNDECIDED,
  isGeneralSpecsOriginal,
  type CommittedSheet,
  type RevisedSheetProposal,
  type SheetDecision,
} from "./revisionMapping";

/**
 * Zone 2 -- one revised tab's pairing row (ADR-0014 D3, the F1 control).
 *
 * The revised tab name is VERBATIM (#152). The dropdown offers every committed original of
 * the source plus an explicit "Declare as a New sheet" -- ordered by the original's
 * sheet_order, NO fuzzy (D3 v1). An UNDECIDED row (an unmatched sheet the human hasn't
 * resolved) is highlighted -- it is the hard stop that blocks Confirm. Everything is editable;
 * nothing binds until the page's Confirm.
 */
interface PairingOption {
  value: string; // an original sheet_name, or NEW_SHEET
  label: string;
  isNew?: boolean;
}

/**
 * The two column labels, declared ONCE here and imported by the page's column header, so the
 * sm+ header and the sub-sm in-row labels can never drift apart. NEW = the tab in the workbook
 * just uploaded; OLD = the committed original it revises.
 */
export const PAIRING_COLUMNS = { newSheet: "New", oldSheet: "Old" } as const;

/** Column-header voice: micro-caps, muted -- reads as a table spine, not as body copy. */
export const PAIRING_COLUMN_LABEL_CLASS =
  "text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground";

interface SheetPairingRowProps {
  revised: RevisedSheetProposal;
  decision: SheetDecision;
  committedSheets: CommittedSheet[];
  onChangeChoice: (choice: string) => void;
  onToggleGeneralSpecs: (value: boolean) => void;
}

export function SheetPairingRow({
  revised,
  decision,
  committedSheets,
  onChangeChoice,
  onToggleGeneralSpecs,
}: SheetPairingRowProps) {
  const options: PairingOption[] = [
    ...committedSheets.map((c) => ({
      value: c.sheet_name,
      label: c.general_specs ? `${c.sheet_name}  ·  specs` : c.sheet_name,
    })),
    { value: NEW_SHEET, label: "➕ Declare as a New sheet", isNew: true },
  ];
  const selected = options.find((o) => o.value === decision.choice) ?? null;
  const undecided = decision.choice === UNDECIDED;
  const showGeneralSpecs = isGeneralSpecsOriginal(committedSheets, decision.choice);

  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center sm:gap-4",
        undecided ? "border-amber-300 bg-amber-50 dark:bg-amber-950/30" : "border-border"
      )}
    >
      <div className="min-w-0 flex-1">
        {/* Below sm the row stacks, so the page's two-column header cannot apply -- each zone
            carries its own label there instead. sm+ falls back to that single header. */}
        <p className={cn(PAIRING_COLUMN_LABEL_CLASS, "mb-0.5 sm:hidden")}>
          {PAIRING_COLUMNS.newSheet}
        </p>
        <p className="truncate text-sm font-medium text-foreground" title={revised.sheet_name}>
          {revised.sheet_name || <span className="italic text-muted-foreground">(unnamed tab)</span>}
        </p>
        <p className="text-xs text-muted-foreground">
          Tab {revised.sheet_order}
          {undecided && <span className="ml-1 text-amber-700 dark:text-amber-400">· needs a decision</span>}
        </p>
      </div>

      <div className="w-full sm:w-72">
        <p className={cn(PAIRING_COLUMN_LABEL_CLASS, "mb-0.5 sm:hidden")}>
          {PAIRING_COLUMNS.oldSheet}
        </p>
        <ReactSelect<PairingOption, false>
          value={selected}
          options={options}
          onChange={(opt) => onChangeChoice(opt ? opt.value : UNDECIDED)}
          isClearable={false}
          placeholder="Map to an original or declare New…"
          classNamePrefix="react-select"
          styles={getSelectStyles<PairingOption, false>()}
        />
        {showGeneralSpecs && (
          <label className="mt-2 flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
            <Checkbox
              checked={decision.general_specs}
              onCheckedChange={(v) => onToggleGeneralSpecs(v === true)}
            />
            Carry as general specs
          </label>
        )}
      </div>
    </div>
  );
}
