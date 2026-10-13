import { useFormContext, useWatch } from "react-hook-form";
import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { FuzzySearchSelect, type TokenSearchConfig } from "@/components/ui/fuzzy-search-select";
import { Input } from "@/components/ui/input";
import { TableCell, TableRow } from "@/components/ui/table";
import type { ChequeFormInput } from "@/utils/cheques/chequeForm";
import {
    EXPENSE_LABELS,
    expenseLabel,
    hiddenExpensesText,
    LINE_LABELS,
    LINE_NEEDS,
    type ChequeLineDraft,
} from "@/utils/cheques/chequeLines";

import { useAllProjects, useEligibleExpenses } from "./useChequePickers";

const PORTAL = { menuPortalTarget: document.body, menuPosition: "fixed" as const };
const SEARCH: TokenSearchConfig = { searchFields: ["label", "value"], minSearchLength: 1, partialMatch: true };

/** A box this line's kind does not ask for. */
export const NotNeeded = () => <span className="text-xs text-muted-foreground">Not needed</span>;

interface ExpenseLineRowProps {
    index: number;
    disabled?: boolean;
    onRemove: () => void;
}

/**
 * One Project Expense or Non-project Expense line of the Add Cheque dialog (spec #1407, #1411). A
 * Project Expense line picks a project, then one of its Project Expenses; a Non-project Expense line
 * a Non Project Expense only. The picker hides expenses already on a live Cheque and says how many.
 */
export const ExpenseLineRow = ({ index, disabled, onRemove }: ExpenseLineRowProps) => {
    const { control, setValue } = useFormContext<ChequeFormInput>();
    const line = useWatch({ control, name: `lines.${index}` }) as ChequeLineDraft;
    const needs = LINE_NEEDS[line.line_type];
    const projects = useAllProjects();
    const { eligible, isLoading } = useEligibleExpenses(line.line_type, line.project);
    const expenseOptions = (eligible?.expenses ?? []).map((e) => ({ value: e.name, label: expenseLabel(e), amount: e.amount }));
    const hidden = hiddenExpensesText(eligible?.hidden);

    const set = (name: keyof ChequeLineDraft, value: string | number) =>
        setValue(`lines.${index}.${name}`, value, { shouldValidate: true, shouldDirty: true });

    return (
        <TableRow className="align-top">
            <TableCell className="text-sm">{LINE_LABELS[line.line_type]}</TableCell>
            <TableCell>
                {needs.project ? (
                    <FormField
                        control={control}
                        name={`lines.${index}.project`}
                        render={({ field }) => (
                            <FormItem>
                                <FuzzySearchSelect
                                    allOptions={projects.options}
                                    tokenSearchConfig={SEARCH}
                                    isLoading={projects.isLoading}
                                    isDisabled={disabled}
                                    value={projects.options.find((o) => o.value === field.value) ?? null}
                                    onChange={(option) => {
                                        field.onChange(option?.value ?? "");
                                        set("payment_name", "");
                                    }}
                                    placeholder="Project"
                                    {...PORTAL}
                                />
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                ) : (
                    <NotNeeded />
                )}
            </TableCell>
            <TableCell>
                <NotNeeded />
            </TableCell>
            <TableCell>
                <FormField
                    control={control}
                    name={`lines.${index}.payment_name`}
                    render={({ field }) => (
                        <FormItem>
                            <FuzzySearchSelect
                                allOptions={expenseOptions}
                                tokenSearchConfig={SEARCH}
                                isLoading={isLoading}
                                isDisabled={disabled || (needs.project && !line.project)}
                                value={expenseOptions.find((o) => o.value === field.value) ?? null}
                                onChange={(option) => {
                                    field.onChange(option?.value ?? "");
                                    // Copied once, on pick; the user may still change it.
                                    if (option) set("amount", option.amount);
                                }}
                                placeholder={`Pick the ${EXPENSE_LABELS[line.line_type]}`}
                                {...PORTAL}
                            />
                            <FormMessage />
                        </FormItem>
                    )}
                />
                {hidden && <p className="mt-1 text-xs text-muted-foreground">{hidden}</p>}
            </TableCell>
            <TableCell>
                <FormField
                    control={control}
                    name={`lines.${index}.amount`}
                    render={({ field }) => (
                        <FormItem>
                            <FormControl>
                                <Input
                                    type="number"
                                    min={0}
                                    step="0.01"
                                    disabled={disabled}
                                    {...field}
                                    value={field.value as number | string}
                                />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />
            </TableCell>
            <TableCell>
                <Button type="button" variant="ghost" size="icon" disabled={disabled} onClick={onRemove} aria-label="Remove line">
                    <Trash2 className="h-4 w-4" />
                </Button>
            </TableCell>
        </TableRow>
    );
};
