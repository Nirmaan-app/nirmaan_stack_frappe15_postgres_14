// Import report dialog (PW-2b-ii) -- renders the PW-2b-i ImportReport as a receipt.
//
// Three variants, one body:
//   "replace" -- merged with the destructive replace-confirm: warning + report +
//                Cancel / Replace workbook. Cancel commits nothing, lock retained.
//   "import"  -- first import from the empty state: report + Cancel / Import.
//   "view"    -- re-open the LAST report from the action bar: report + Close only.
//
// The report SECTION is skipped for a pure no-op report (the caller decides whether to
// open the dialog at all for import; for replace the destructive confirm still shows,
// just without a report table).

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
import type { ImportReport, TransformRecord } from "./pricingTransforms";

/** Cap the row list so a 296-frozen-cell report cannot lock up the dialog. */
const MAX_ROWS = 40;

export type ReportVariant = "replace" | "import" | "view";

interface ImportReportDialogProps {
	open: boolean;
	report: ImportReport | null;
	fileName?: string;
	variant: ReportVariant;
	busy?: boolean;
	/** Proceed (replace / import). Absent for "view". */
	onConfirm?: () => void;
	/** Cancel (replace / import) or Close (view). */
	onClose: () => void;
}

export function reportIsNoop(r: ImportReport | null | undefined): boolean {
	if (!r) return true;
	return (
		!r.transforms.length && !r.frozen.length && !r.abstained.length && !r.clamp.length
	);
}

function harmonizedCount(transforms: TransformRecord[]): number {
	return transforms.filter((t) => t.classes.includes("harmonized")).length;
}

function summaryLine(r: ImportReport): string {
	const parts: string[] = [];
	if (r.transforms.length) parts.push(`${r.transforms.length} rewritten`);
	const h = harmonizedCount(r.transforms);
	if (h) parts.push(`${h} harmonized`);
	if (r.frozen.length) parts.push(`${r.frozen.length} frozen`);
	if (r.abstained.length) parts.push(`${r.abstained.length} left unchanged`);
	const dropped = r.clamp.reduce((n, c) => n + c.cellsDropped, 0);
	if (dropped) parts.push(`${dropped.toLocaleString()} empty cells trimmed`);
	const added = r.helpers.filter((hp) => !hp.reused).length;
	if (added) parts.push(`${added} helper column pair${added === 1 ? "" : "s"} added`);
	return parts.length ? parts.join(" · ") : "No changes.";
}

interface Row {
	sheet: string;
	cell: string;
	cls: string;
	oldF: string;
	newF: string;
	note?: string;
	tone: "normal" | "frozen" | "flagged" | "declined";
	// PW-2d save-fix rows only: whether the value was computed at once or is blank until recalc.
	valueComputed?: boolean;
}

function buildRows(r: ImportReport): Row[] {
	const rows: Row[] = [];
	for (const t of r.transforms) {
		rows.push({
			sheet: t.sheet,
			cell: t.cell,
			cls: t.classes.join(", "),
			oldF: t.oldF,
			newF: t.newF ?? "",
			note: t.note,
			tone: "normal",
			valueComputed: t.valueComputed,
		});
	}
	for (const f of r.frozen) {
		const flagged = !!f.note && /IMPORTRANGE/i.test(f.note);
		rows.push({
			sheet: f.sheet,
			cell: f.cell,
			cls: "frozen",
			oldF: f.oldF,
			newF: "(value kept, formula removed)",
			note: f.note,
			tone: flagged ? "flagged" : "frozen",
		});
	}
	for (const a of r.abstained) {
		rows.push({
			sheet: a.sheet,
			cell: a.cell,
			cls: "declined",
			oldF: a.formula,
			newF: "(unchanged)",
			note: a.reason,
			tone: "declined",
		});
	}
	return rows;
}

const TONE_CLASS: Record<Row["tone"], string> = {
	normal: "",
	frozen: "bg-muted/40",
	flagged: "bg-amber-50 dark:bg-amber-950/30",
	declined: "bg-amber-50 dark:bg-amber-950/30",
};

function ReportBody({ report }: { report: ImportReport }) {
	const rows = buildRows(report);
	const shown = rows.slice(0, MAX_ROWS);
	const dropped = report.clamp.reduce((n, c) => n + c.cellsDropped, 0);
	const addedHelpers = report.helpers.filter((h) => !h.reused);

	return (
		<div className="space-y-3">
			<p className="text-sm font-medium text-foreground">{summaryLine(report)}</p>

			{report.clamp.length > 0 && (
				<p className="text-xs text-muted-foreground">
					Trimmed {dropped.toLocaleString()} empty cells across {report.clamp.length} sheet
					{report.clamp.length === 1 ? "" : "s"} (row bloat from the source export).
				</p>
			)}

			{shown.length > 0 && (
				<div className="max-h-72 overflow-auto rounded-md border border-border">
					<table className="w-full text-xs">
						<thead className="sticky top-0 bg-background">
							<tr className="border-b border-border text-left text-muted-foreground">
								<th className="px-2 py-1 font-medium">Cell</th>
								<th className="px-2 py-1 font-medium">Change</th>
							</tr>
						</thead>
						<tbody>
							{shown.map((row, i) => (
								<tr
									key={`${row.sheet}-${row.cell}-${i}`}
									className={`border-b border-border last:border-0 align-top ${TONE_CLASS[row.tone]}`}
								>
									<td className="px-2 py-1 whitespace-nowrap">
										<div className="font-medium text-foreground">
											{row.sheet} — {row.cell}
										</div>
										<div className="text-muted-foreground">{row.cls}</div>
									</td>
									<td className="px-2 py-1">
										<code className="break-all text-muted-foreground line-through">{row.oldF}</code>
										<div className="break-all text-foreground mt-0.5">{row.newF}</div>
										{row.valueComputed !== undefined && (
											<div
												className={`mt-0.5 ${
													row.valueComputed
														? "text-emerald-600 dark:text-emerald-400"
														: "text-muted-foreground"
												}`}
											>
												{row.valueComputed ? "value computed" : "blank until recalc"}
											</div>
										)}
										{row.note && (
											<div
												className={`mt-0.5 ${
													row.tone === "declined" || row.tone === "flagged"
														? "text-amber-700 dark:text-amber-400"
														: "text-muted-foreground"
												}`}
											>
												{row.note}
											</div>
										)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
			{rows.length > MAX_ROWS && (
				<p className="text-xs text-muted-foreground">
					Showing the first {MAX_ROWS} of {rows.length} changed cells.
				</p>
			)}

			{addedHelpers.length > 0 && (
				<details className="text-xs">
					<summary className="cursor-pointer text-muted-foreground">
						{addedHelpers.length} helper column pair{addedHelpers.length === 1 ? "" : "s"} added
						(hidden)
					</summary>
					<ul className="mt-1 ml-4 list-disc text-muted-foreground">
						{addedHelpers.map((h, i) => (
							<li key={`${h.sheet}-${h.keyCol}-${i}`}>
								{h.sheet}!{h.keyCol}:{h.valCol}
							</li>
						))}
					</ul>
				</details>
			)}
		</div>
	);
}

export function ImportReportDialog({
	open,
	report,
	fileName,
	variant,
	busy,
	onConfirm,
	onClose,
}: ImportReportDialogProps) {
	const showReport = !reportIsNoop(report);

	// PW-2d: a re-opened save-fix report reads "Fixed at save", not "Import report".
	const isSaveFix = report?.origin === "save-fix";
	const title =
		variant === "replace"
			? "Replace this workbook?"
			: variant === "import"
			? "Import this workbook?"
			: isSaveFix
			? "Fixed at save"
			: "Import report";

	return (
		<AlertDialog open={open} onOpenChange={(o) => !o && onClose()}>
			<AlertDialogContent className="max-w-2xl">
				<AlertDialogHeader>
					<AlertDialogTitle>{title}</AlertDialogTitle>
					<AlertDialogDescription asChild>
						<div className="space-y-3">
							{variant === "replace" && (
								<p>
									This replaces the entire workbook content with{" "}
									<span className="font-medium text-foreground">{fileName}</span>. The current
									content is preserved as version history; any unsaved edits are discarded.
								</p>
							)}
							{variant === "import" && fileName && (
								<p>
									Importing <span className="font-medium text-foreground">{fileName}</span>. The
									pipeline adjusted some formulas so the pricing engine can evaluate them —
									review below.
								</p>
							)}
							{showReport && report && <ReportBody report={report} />}
						</div>
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					{variant === "view" ? (
						<AlertDialogAction onClick={onClose}>Close</AlertDialogAction>
					) : (
						<>
							<AlertDialogCancel disabled={busy} onClick={onClose}>
								Cancel
							</AlertDialogCancel>
							<AlertDialogAction disabled={busy} onClick={onConfirm}>
								{variant === "replace" ? "Replace workbook" : "Import"}
							</AlertDialogAction>
						</>
					)}
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
