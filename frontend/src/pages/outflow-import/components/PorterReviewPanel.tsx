// src/pages/outflow-import/components/PorterReviewPanel.tsx

import { useCallback, useMemo, useState } from "react";
import { AlertTriangle, Info, Loader2, MapPin, User } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/utils/FormatDate";
import formatToIndianRupee from "@/utils/FormatPrice";

import { usePorterPlacement } from "../hooks/usePorterPlacement";
import { describeFrappeError } from "../outflowTableModel";
import {
    chosenProject,
    choiceItems,
    choiceSummary,
    keepShownOrder,
    likelyChoices,
    listedBecause,
    needsPerson,
    placementLabel,
    reasonLabel,
    type PorterReviewLine,
    type ReviewItem,
} from "../porterReview";
import { orders } from "../porterWords";
import { NON_PROJECT, PorterProjectSelect, projectOptions, type ProjectOption } from "./PorterProjectSelect";

/** Saves one choice: `rows` (a whole group, or one order of it) onto `project`, or Not a project (""). */
type OnPlace = (key: string, rows: string[], project: string) => void;

/**
 * Choose projects (#1446, #1560, #1563): the orders of a Validated Porter import that need a person, by
 * remark group (assigned once for the group, or order by order with "Choose per order") or one by one where
 * the order has no remark. Sure placements are not listed (`choiceItems`). Each choice — a Won project, or
 * Not a project — is saved to the import's lines as it is made, the plan Create reads, so closing the dialog
 * loses nothing.
 */
export const PorterReviewPanel = ({
    batch,
    onPlaced,
}: {
    batch: string;
    /** A placement was saved: the dialog re-reads the import's status, so the progress bar counts it (#1556). */
    onPlaced?: () => void;
}) => {
    const { review, error, place, saving, saveError } = usePorterPlacement(batch, onPlaced);

    // The order the items were first shown in: an edit changes an item's tier, and moving it then would
    // pull it from under the reader's cursor. Kept in state, updated while rendering when the list changes.
    const [shownKeys, setShownKeys] = useState<string[]>([]);
    const items = useMemo(
        () => keepShownOrder(choiceItems(review?.lines ?? []), shownKeys),
        [review, shownKeys],
    );
    const itemKeys = items.map((item) => item.key);
    if (itemKeys.join("\n") !== shownKeys.join("\n")) setShownKeys(itemKeys);

    // Not a project is its own button, never a pick in the list (#1560).
    const options = useMemo(
        () => projectOptions(review?.projects ?? []).filter((option) => option !== NON_PROJECT),
        [review],
    );

    const handlePlace = useCallback<OnPlace>((key, rows, project) => void place(key, rows, project), [place]);

    if (error) {
        return (
            <p className="rounded-md bg-destructive/5 p-3 text-sm text-destructive">
                {describeFrappeError(error, "Could not load the review.")}
            </p>
        );
    }
    if (!review) {
        return (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading the orders…
            </p>
        );
    }

    const summary = choiceSummary(review.lines);
    return (
        <section className="space-y-3">
            <div>
                <h3 className="text-sm font-semibold">{summary.heading}</h3>
                {summary.note && <p className="text-xs text-muted-foreground">{summary.note}</p>}
                {items.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                        Orders with the same remark are placed together. Each choice is saved as you make it.
                    </p>
                )}
            </div>
            {saveError && (
                <p className="flex items-start gap-2 rounded-md bg-destructive/5 p-2 text-xs text-destructive">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    {saveError}
                </p>
            )}
            <ul className="space-y-2">
                {items.map((item) => (
                    <ReviewCard
                        key={item.key}
                        item={item}
                        options={options}
                        quick={likelyChoices(item, review.projects)}
                        saving={saving}
                        onPlace={handlePlace}
                    />
                ))}
            </ul>
            {items.length > 0 && (
                <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                    <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    Only Won projects can take expenses. If a project is missing, check its status.
                </p>
            )}
        </section>
    );
};

const ReviewCard = ({
    item,
    options,
    quick,
    saving,
    onPlace,
}: {
    item: ReviewItem;
    options: ProjectOption[];
    /** The two likely projects, as one-click choices; empty when the placement did not name two. */
    quick: ProjectOption[];
    saving: string | null;
    onPlace: OnPlace;
}) => {
    const [perOrder, setPerOrder] = useState(false);
    const undecided = item.lines.some(needsPerson);
    // A suggestion that needs a person is not shown as chosen: picking it is the person's choice.
    const chosen = undecided || item.mixed ? null : item.project ?? "";
    const badge = listedBecause(item);
    const count = item.lines.length;
    return (
        <li className={`space-y-2 rounded-md border p-3 ${undecided ? "border-amber-300 bg-amber-50/40" : ""}`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                    {item.kind === "group" ? (
                        <div className="font-medium">
                            “{item.remark}”
                            <span className="ml-2 text-xs font-normal text-muted-foreground">
                                {item.city} · {orders(count)} · {formatToIndianRupee(item.fare)}
                            </span>
                        </div>
                    ) : (
                        <OrderFacts line={item.lines[0]} />
                    )}
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        {badge && (
                            <Badge variant="outline" className="border-amber-300 bg-amber-100 text-amber-800">
                                {badge}
                            </Badge>
                        )}
                        <span>
                            {/* No project suggested: the reason alone ("No project found"), never "Non-Project". */}
                            {undecided && !item.project && !item.mixed
                                ? ""
                                : `${undecided ? "Suggested: " : ""}${chosen === "" ? "Not a project" : placementLabel(item)} — `}
                            {item.reasons.length ? item.reasons.map(reasonLabel).join("; ") : reasonLabel(null)}
                        </span>
                    </div>
                </div>
                {!perOrder && (
                    <PlaceControl
                        id={item.key}
                        rows={item.toPlace}
                        chosen={chosen}
                        options={options}
                        quick={quick}
                        placeholder={item.mixed ? `Choose one for all ${count}` : "Choose a project…"}
                        disabled={!item.editable}
                        saving={saving}
                        onPlace={onPlace}
                    />
                )}
            </div>
            {item.kind === "group" && count > 1 && (
                <div className="space-y-1 text-xs">
                    <button
                        type="button"
                        className="text-muted-foreground underline-offset-2 hover:underline"
                        aria-expanded={perOrder}
                        onClick={() => setPerOrder((open) => !open)}
                    >
                        {perOrder ? "Choose for the whole group" : "Choose per order"}
                    </button>
                    {perOrder && (
                        <ul className="space-y-1">
                            {item.lines.map((line) => (
                                <li key={line.name} className="flex flex-wrap items-start justify-between gap-2 rounded bg-muted/40 p-2">
                                    <div className="min-w-0 flex-1">
                                        <OrderFacts line={line} />
                                    </div>
                                    <PlaceControl
                                        id={`order:${line.name}`}
                                        rows={[line.name]}
                                        chosen={chosenProject(line)}
                                        options={options}
                                        quick={quick}
                                        placeholder="Choose a project…"
                                        disabled={!line.editable}
                                        saving={saving}
                                        onPlace={onPlace}
                                    />
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}
        </li>
    );
};

/**
 * One placement choice, for a group or for one order: the two likely projects as one-click buttons with
 * "Other…" for the full picker (#1563), or the picker itself; and Not a project. `chosen` is the project a
 * person settled on ("" for Not a project), or null while it is still undecided.
 */
const PlaceControl = ({
    id,
    rows,
    chosen,
    options,
    quick,
    placeholder,
    disabled,
    saving,
    onPlace,
}: {
    id: string;
    rows: string[];
    chosen: string | null;
    options: ProjectOption[];
    quick: ProjectOption[];
    placeholder: string;
    disabled: boolean;
    saving: string | null;
    onPlace: OnPlace;
}) => {
    const busy = saving === id;
    const off = disabled || saving !== null;
    const chosenElsewhere = chosen !== null && chosen !== "" && !quick.some((option) => option.value === chosen);
    const [other, setOther] = useState(chosenElsewhere);
    const showPicker = quick.length === 0 || other || chosenElsewhere;
    return (
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:max-w-[28rem] sm:justify-end">
            {quick.map((option) => (
                <Button
                    key={option.value}
                    type="button"
                    size="sm"
                    variant={chosen === option.value ? "default" : "outline"}
                    aria-pressed={chosen === option.value}
                    disabled={off}
                    onClick={() => onPlace(id, rows, option.value)}
                >
                    {option.label}
                </Button>
            ))}
            {showPicker ? (
                <div className="min-w-0 flex-1 sm:w-64 sm:flex-none">
                    <PorterProjectSelect
                        options={options}
                        value={options.find((option) => option.value === chosen) ?? null}
                        onChange={(option) => option && onPlace(id, rows, option.value)}
                        placeholder={placeholder}
                        isDisabled={off}
                    />
                </div>
            ) : (
                <Button type="button" size="sm" variant="ghost" disabled={off} onClick={() => setOther(true)}>
                    Other…
                </Button>
            )}
            <Button
                type="button"
                size="sm"
                variant={chosen === "" ? "default" : "outline"}
                aria-pressed={chosen === ""}
                disabled={off}
                onClick={() => onPlace(id, rows, "")}
            >
                Not a project
            </Button>
            {busy && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />}
        </div>
    );
};

/** One order: when, who booked it, its fare, and from where to where. */
const OrderFacts = ({ line }: { line: PorterReviewLine }) => (
    <div className="space-y-0.5 text-xs">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
            <span className="font-medium text-foreground">{line.crn}</span>
            {line.completed_on && <span>{formatDate(line.completed_on)}</span>}
            <span className="flex items-center gap-1">
                <User className="h-3 w-3" />
                {line.booked_by || "—"}
            </span>
            <span className="tabular-nums">{formatToIndianRupee(line.fare)}</span>
            {!line.group_key && <span className="text-muted-foreground">{line.city} · no remark</span>}
        </div>
        <div className="flex items-start gap-1 text-muted-foreground">
            <MapPin className="mt-0.5 h-3 w-3 shrink-0" />
            <span>
                {line.from_address || "—"} → {line.to_address || "—"}
            </span>
        </div>
    </div>
);
