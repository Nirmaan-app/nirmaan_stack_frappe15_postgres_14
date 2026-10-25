// src/pages/outflow-import/components/CardImportReview.tsx

import { useMemo } from "react";
import { CheckCircle2, FileText, Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FuzzySearchSelect, type TokenSearchConfig } from "@/components/ui/fuzzy-search-select";
import formatToIndianRupee from "@/utils/FormatPrice";

import {
    cardCreateProgress,
    cardSuggestNote,
    merchantRetype,
    typeChoiceLabel,
    typeSourceTitle,
} from "../cardCreate";
import {
    CARD_UPLOADED_NOTE,
    cardCountsLine,
    cardDay,
    cardPeriodLabel,
    cardTotalsRows,
    type CardImport,
    type CardImportLine,
} from "../creditCardImport";
import { cardWorkLines } from "../cardCreditsView";
import { CardSkippedLines } from "./CardSkippedLines";

interface TypeOption {
    value: string;
    label: string;
}

const TYPE_SEARCH: TokenSearchConfig = {
    searchFields: ["label"],
    partialMatch: true,
    fieldWeights: { label: 2.0 },
};

/**
 * A Credit Card Statement import once it is in: the statement's header (holder, company, statement date,
 * billing period), its five summary totals and every line (#1566). Each spend shows its expense type, which
 * Review changes while Create would still write the spend (#1568): `onRetype` saves it at once, and the
 * fallback nobody has chosen is marked "Check". The type arrives from the suggestion job (#1569): its badge
 * names its source (earlier statement, AI, fallback), and one link gives it to every spend of the merchant.
 * Rendered by `ImportStatementDialog`, which holds Create and
 * Discard in its footer.
 */
export const CardImportReview = ({
    card,
    onRetype,
    retyping = null,
}: {
    card: CardImport;
    /** Save `expenseType` on `rows` (default: `line` alone). */
    onRetype?: (line: string, expenseType: string, rows?: string[]) => void;
    /** The spend whose type is being saved. */
    retyping?: string | null;
}) => {
    const options = useMemo<TypeOption[]>(
        () => card.expense_types.map((name) => ({ value: name, label: name })),
        [card.expense_types],
    );
    const progress = cardCreateProgress(card) ?? cardSuggestNote(card);

    return (
        <div className="space-y-4">
            <div className="space-y-3 rounded-md border bg-muted/30 p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
                    <span className="text-base font-semibold">{card.holder}</span>
                    <span className="text-sm text-muted-foreground">{cardPeriodLabel(card)}</span>
                </div>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr_auto_1fr]">
                    <dt className="text-muted-foreground">Company</dt>
                    <dd>{card.company}</dd>
                    <dt className="text-muted-foreground">Statement date</dt>
                    <dd>{cardDay(card.statement_date)}</dd>
                    <dt className="text-muted-foreground">File</dt>
                    <dd className="flex min-w-0 items-center gap-1.5">
                        <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        {card.statement_file ? (
                            <a
                                href={card.statement_file}
                                target="_blank"
                                rel="noreferrer"
                                className="truncate text-primary underline-offset-2 hover:underline"
                            >
                                {card.original_filename}
                            </a>
                        ) : (
                            <span className="truncate">{card.original_filename}</span>
                        )}
                    </dd>
                    <dt className="text-muted-foreground">Import</dt>
                    <dd>{card.batch}</dd>
                </dl>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                    {cardTotalsRows(card).map((row) => (
                        <div key={row.label} className="rounded-md border bg-background px-3 py-2">
                            <div className="text-[11px] text-muted-foreground">{row.label}</div>
                            <div className="whitespace-nowrap text-sm font-medium tabular-nums">
                                {formatToIndianRupee(row.amount)}
                            </div>
                        </div>
                    ))}
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                    <span className="flex items-center gap-1.5 font-medium">
                        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                        {cardCountsLine(card)}
                    </span>
                    <span className="text-xs text-muted-foreground">{progress ?? CARD_UPLOADED_NOTE}</span>
                </div>
            </div>

            <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-xs text-muted-foreground">
                        <tr>
                            <th className="px-3 py-2 text-left font-medium">Date</th>
                            <th className="px-3 py-2 text-left font-medium">SerNo</th>
                            <th className="px-3 py-2 text-left font-medium">Transaction details</th>
                            <th className="px-3 py-2 text-right font-medium">Amount</th>
                            <th className="min-w-[15rem] px-3 py-2 text-left font-medium">Expense type</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y">
                        {cardWorkLines(card).map((line) => (
                            <tr key={line.name}>
                                <td className="whitespace-nowrap px-3 py-1.5 tabular-nums">{cardDay(line.date)}</td>
                                <td className="whitespace-nowrap px-3 py-1.5 tabular-nums text-muted-foreground">
                                    {line.serno}
                                </td>
                                <td className="px-3 py-1.5">{line.details}</td>
                                <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">
                                    {formatToIndianRupee(line.amount)}
                                    {line.is_credit && (
                                        <Badge
                                            variant="outline"
                                            className="ml-1.5 border-emerald-200 bg-emerald-50 px-1 py-0 text-[10px] text-emerald-700"
                                        >
                                            CR
                                        </Badge>
                                    )}
                                </td>
                                <td className="px-3 py-1">
                                    <SpendType
                                        line={line}
                                        forMerchant={merchantRetype(card.lines, line)}
                                        options={options}
                                        saving={retyping === line.name}
                                        disabled={retyping !== null || card.create_running || !onRetype}
                                        onChange={(type, rows) => onRetype?.(line.name, type, rows)}
                                    />
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <CardSkippedLines card={card} />
        </div>
    );
};

/** A spend's type: a picker while Create would still write it, else the type and its Expense. */
const SpendType = ({
    line,
    forMerchant,
    options,
    saving,
    disabled,
    onChange,
}: {
    line: CardImportLine;
    /** Give this spend's type to every retypable spend of its merchant (#1569); null when not offered. */
    forMerchant: ReturnType<typeof merchantRetype>;
    options: TypeOption[];
    saving: boolean;
    disabled: boolean;
    onChange: (expenseType: string, rows?: string[]) => void;
}) => {
    if (line.is_credit) return <span className="text-muted-foreground">—</span>;
    const badge = typeChoiceLabel(line);
    const chip = badge && (
        <Badge
            variant="outline"
            title={typeSourceTitle(line) ?? undefined}
            className={
                line.check
                    ? "shrink-0 border-amber-300 bg-amber-50 px-1 py-0 text-[10px] text-amber-800"
                    : "shrink-0 px-1 py-0 text-[10px] text-muted-foreground"
            }
        >
            {badge}
        </Badge>
    );
    if (!line.editable) {
        return (
            <div className="flex flex-col gap-0.5">
                <span>{line.expense_type}</span>
                {line.expense ? (
                    <span className="text-[11px] text-muted-foreground">{line.expense}</span>
                ) : (
                    line.outcome_note && <span className="text-[11px] text-destructive">{line.outcome_note}</span>
                )}
            </div>
        );
    }
    return (
        <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-1.5">
                <div className="min-w-0 flex-1">
                    <FuzzySearchSelect<TypeOption, false>
                        allOptions={options}
                        tokenSearchConfig={TYPE_SEARCH}
                        value={line.expense_type ? { value: line.expense_type, label: line.expense_type } : null}
                        onChange={(option) => option && option.value !== line.expense_type && onChange(option.value)}
                        placeholder="Choose a type"
                        isDisabled={disabled}
                        menuPortalTarget={document.body}
                        menuPosition="fixed"
                    />
                </div>
                {saving ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" /> : chip}
            </div>
            {forMerchant && (
                <Button
                    type="button"
                    variant="link"
                    size="sm"
                    className="h-auto self-start p-0 text-[11px]"
                    disabled={disabled}
                    onClick={() => onChange(forMerchant.expenseType, forMerchant.rows)}
                >
                    {forMerchant.label}
                </Button>
            )}
            {/* A spend a Create run could not write says why; Create retries it. */}
            {line.row_status === "Error" && line.outcome_note && (
                <span className="text-[11px] text-destructive">{line.outcome_note}</span>
            )}
        </div>
    );
};
