// src/pages/outflow-import/components/ImportSelect.tsx

import { useMemo, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { OutflowImportOption } from "@/types/NirmaanStack/OutflowImportBatch";

import {
    importOptionLabel,
    importPeriodLabel,
    importUploaderLabel,
} from "../outflowTableModel";

/**
 * The "no import chosen" row's `cmdk` value.
 *
 * ⚠️ NAMED, NOT BLANK. An empty row reads as "nothing chosen yet" — a state this screen does not
 * have — where the truth is that every import is in view. (Carried verbatim from the Radix `Select`
 * this control replaced; the reasoning is the selector's, not the widget's.)
 */
const ALL_IMPORTS = "__all__";

interface Props {
    /**
     * The statements on offer, ALREADY NARROWED BY THE SOURCE SCOPE.
     *
     * ⚠️ THE OPTIONS ARE NARROWED, NOT THE SELECTION (owner ask). The caller owns that narrowing —
     * see `offeredImports` in `ImportSummaryPanel`, which keeps a pinned import outside the current
     * source in the list rather than dropping it. This control renders what it is handed and never
     * re-filters by scope.
     */
    options: readonly OutflowImportOption[];
    /** The pinned statement, or `undefined` for ALL of them. */
    value?: string;
    onChange: (batch?: string) => void;
}

/**
 * The Import selector — a searchable combobox over up to sixty statements (`list_imports`' limit).
 *
 * ⚠️ IT REPLACED A RADIX `Select`, AND THE REASON IS THE COUNT. Sixty statements in a plain list
 * offer no way to find one except scrolling; the trigger and the meaning are unchanged, only the
 * finding is.
 *
 * ⚠️ IT IS NOT DISABLED WHILE AN IMPORT IS PINNED, AND THAT IS THE ONE CONTROL THAT ISN'T. Source
 * and Period are greyed then — a statement has one source and the period is IGNORED rather than
 * ANDed (owner ruling 2026-08-12) — but this control is how a reader gets back out of a pinned
 * statement, including one they arrived at by deep link. Disabling it would strand them.
 *
 * ⚠️ THE TRIGGER STAYS ONE LINE AT `h-8`. Source, Import and Period sit in one flex row and all
 * three are `h-8`; a two-line trigger would break that row's alignment. The two-line shape belongs
 * to the ITEMS, where there is room for it.
 */
export const ImportSelect = ({ options, value, onChange }: Props) => {
    const [open, setOpen] = useState(false);

    const selected = useMemo(
        () => options.find((option) => option.name === value),
        [options, value]
    );

    /**
     * Search matches the filename, the uploader and the period text.
     *
     * ⚠️ `All imports` IS NEVER FILTERED OUT — it always scores, whatever the search. It is the way
     * back to the whole screen, so a search that hid it would make the widest scope reachable only
     * by clearing the box first. Keeping it a REAL `cmdk` item (rather than force-mounting it
     * outside the filter) is what keeps arrow keys and Enter working on it.
     *
     * Token-AND rather than one substring, so `shanu may` finds a May statement of Shanu's.
     */
    const filter = (itemValue: string, search: string, keywords?: string[]) => {
        if (itemValue === ALL_IMPORTS) return 1;
        const tokens = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
        if (!tokens.length) return 1;
        const haystack = [itemValue, ...(keywords ?? [])].join(" ").toLowerCase();
        return tokens.every((token) => haystack.includes(token)) ? 1 : 0;
    };

    const choose = (batch?: string) => {
        onChange(batch);
        setOpen(false);
    };

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    type="button"
                    variant="outline"
                    role="combobox"
                    aria-expanded={open}
                    className="h-8 w-[340px] max-w-full justify-between px-3 font-normal"
                >
                    <span className="truncate">
                        {selected ? importOptionLabel(selected) : "All imports"}
                    </span>
                    <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
                </Button>
            </PopoverTrigger>
            <PopoverContent
                className="w-[--radix-popover-trigger-width] p-0"
                align="start"
            >
                <Command filter={filter}>
                    <CommandInput placeholder="Search statements…" />
                    <CommandList>
                        {/* Active voice, and it states what happened. There is nothing to
                            apologise for — the search simply matched no statement. */}
                        <CommandEmpty>No statements match that.</CommandEmpty>
                        <CommandGroup>
                            <CommandItem value={ALL_IMPORTS} onSelect={() => choose(undefined)}>
                                <Check
                                    className={cn(
                                        "mr-2 h-4 w-4 shrink-0",
                                        value ? "opacity-0" : "opacity-100"
                                    )}
                                />
                                <span className="text-sm font-medium">All imports</span>
                            </CommandItem>
                            {options.map((option) => (
                                <ImportRow
                                    key={option.name}
                                    option={option}
                                    current={option.name === value}
                                    onSelect={() => choose(option.name)}
                                />
                            ))}
                        </CommandGroup>
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    );
};

/**
 * One statement on the list.
 *
 * ⚠️ THE PERIOD COMES FIRST ON THE SECOND LINE. `list_imports` is ORDERED by period, so that is
 * what a reader scans down the list for; the uploader is the tie-breaker, not the key.
 *
 * ⚠️ THE UPLOADER IS SHORTENED FOR DISPLAY AND THE FULL ID GOES IN `title` — the split
 * `importUploaderLabel` documents. A blank label drops the separator with it: a dangling ` · `
 * would read as a value that failed to render rather than one that was never there.
 *
 * The source micro-label matches the treatment `ImportHistoryDialog`'s `HistoryRow` gives it — a
 * KIND, not a status, so it is quiet rather than a second chip. The two surfaces are fed by the same
 * `list_imports`, so they must not disagree about what a statement looks like.
 */
const ImportRow = ({
    option,
    current,
    onSelect,
}: {
    option: OutflowImportOption;
    current: boolean;
    onSelect: () => void;
}) => {
    const filename = option.original_filename || option.name;
    const uploader = importUploaderLabel(option);
    const period = importPeriodLabel(option);

    return (
        <CommandItem
            value={option.name}
            keywords={[filename, uploader, option.uploaded_by ?? "", period]}
            title={option.uploaded_by || undefined}
            onSelect={onSelect}
            className="items-start"
        >
            <Check
                className={cn(
                    "mr-2 mt-0.5 h-4 w-4 shrink-0",
                    current ? "opacity-100" : "opacity-0"
                )}
            />
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{filename}</span>
                    {option.source && (
                        <span className="ml-auto shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                            {option.source}
                        </span>
                    )}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                    {period}
                    {uploader ? ` · ${uploader}` : ""}
                </div>
            </div>
        </CommandItem>
    );
};
