// src/pages/outflow-import/components/PorterReviewPanel.tsx

import { useCallback, useMemo, useRef, useState } from "react";
import { useFrappeGetCall, useFrappePostCall } from "frappe-react-sdk";
import { AlertTriangle, Loader2, MapPin, User } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/utils/FormatDate";
import formatToIndianRupee from "@/utils/FormatPrice";

import { describeFrappeError } from "../outflowTableModel";
import {
    PORTER_PLACE_METHOD,
    PORTER_REVIEW_METHOD,
    keepShownOrder,
    placementLabel,
    reasonLabel,
    reviewItems,
    strengthLabel,
    type PorterReview,
    type PorterReviewLine,
    type ReviewItem,
} from "../porterReview";
import { PorterProjectSelect, projectOptions, type ProjectOption } from "./PorterProjectSelect";

/**
 * Review projects (#1446): every completed order of a Validated Porter import, by remark group (assigned
 * once for the group) or one by one where the order has no remark. Each choice is saved to the import's
 * lines as it is made — the plan Create reads — so closing the dialog loses nothing.
 */
export const PorterReviewPanel = ({
    batch,
    onPlaced,
}: {
    batch: string;
    /** A placement was saved: the dialog re-reads the import's status, so the progress bar counts it (#1556). */
    onPlaced?: () => void;
}) => {
    const { data, error, mutate } = useFrappeGetCall<{ message: PorterReview }>(
        PORTER_REVIEW_METHOD,
        { batch },
        `porter-review::${batch}`,
    );
    const { call: place } = useFrappePostCall<{ message: PorterReview }>(PORTER_PLACE_METHOD);
    /** The item whose placement is being saved. */
    const [saving, setSaving] = useState<string | null>(null);
    const [saveError, setSaveError] = useState<string | null>(null);

    // The order the items were first shown in: an edit changes an item's tier, and moving it then would
    // pull it from under the reader's cursor.
    const shown = useRef<string[]>([]);
    const items = useMemo(() => {
        const ordered = keepShownOrder(reviewItems(data?.message.lines ?? []), shown.current);
        shown.current = ordered.map((item) => item.key);
        return ordered;
    }, [data]);

    const options = useMemo(() => projectOptions(data?.message.projects ?? []), [data]);

    const handlePlace = useCallback(
        async (item: ReviewItem, project: string) => {
            setSaving(item.key);
            setSaveError(null);
            try {
                const response = await place({ batch, rows: item.toPlace, project });
                await mutate(response, { revalidate: false });
                onPlaced?.();
            } catch (err) {
                setSaveError(describeFrappeError(err, "The change was not saved."));
            } finally {
                setSaving(null);
            }
        },
        [batch, place, mutate, onPlaced],
    );

    if (error) {
        return (
            <p className="rounded-md bg-destructive/5 p-3 text-sm text-destructive">
                {describeFrappeError(error, "Could not load the review.")}
            </p>
        );
    }
    if (!data) {
        return (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading the orders…
            </p>
        );
    }

    const toCheck = items.filter((item) => item.needsCheck).length;
    return (
        <section className="space-y-3">
            <div>
                <h3 className="text-sm font-semibold">Review projects</h3>
                <p className="text-xs text-muted-foreground">
                    {data.message.lines.length} orders · {toCheck} to check. Orders with the same remark are placed
                    together. Each change is saved as you make it; an order with no project becomes a Non-Project
                    expense.
                </p>
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
                        saving={saving === item.key}
                        onPlace={handlePlace}
                    />
                ))}
            </ul>
        </section>
    );
};

const ReviewCard = ({
    item,
    options,
    saving,
    onPlace,
}: {
    item: ReviewItem;
    options: ProjectOption[];
    saving: boolean;
    onPlace: (item: ReviewItem, project: string) => void;
}) => {
    const value = item.mixed ? null : options.find((option) => option.value === (item.project ?? "")) ?? null;
    const strength = item.mixed ? "Check" : strengthLabel(item.lines.find((line) => line.strength === "Check")?.strength);
    const count = item.lines.length;
    return (
        <li className={`space-y-2 rounded-md border p-3 ${item.needsCheck ? "border-amber-300 bg-amber-50/40" : ""}`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                    {item.kind === "group" ? (
                        <div className="font-medium">
                            “{item.remark}”
                            <span className="ml-2 text-xs font-normal text-muted-foreground">
                                {item.city} · {count} order{count === 1 ? "" : "s"} · {formatToIndianRupee(item.fare)}
                            </span>
                        </div>
                    ) : (
                        <OrderFacts line={item.lines[0]} />
                    )}
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        {strength && (
                            <Badge variant="outline" className="border-amber-300 bg-amber-100 text-amber-800">
                                {strength}
                            </Badge>
                        )}
                        <span>
                            {placementLabel(item)} — {item.reasons.length ? item.reasons.map(reasonLabel).join("; ") : reasonLabel(null)}
                        </span>
                    </div>
                </div>
                <div className="flex w-full items-center gap-2 sm:w-72">
                    <div className="min-w-0 flex-1">
                        <PorterProjectSelect
                            options={options}
                            value={value}
                            onChange={(option) => onPlace(item, option?.value ?? "")}
                            placeholder={item.mixed ? `Choose one for all ${count}` : "Choose a project…"}
                            isClearable={Boolean(item.project)}
                            isDisabled={saving || !item.editable}
                        />
                    </div>
                    {saving && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />}
                </div>
            </div>
            {item.kind === "group" && (
                <details className="text-xs">
                    <summary className="cursor-pointer text-muted-foreground">
                        {count === 1 ? "Show the order" : `Show the ${count} orders`}
                    </summary>
                    <ul className="mt-1 space-y-1">
                        {item.lines.map((line) => (
                            <li key={line.name} className="rounded bg-muted/40 p-2">
                                <OrderFacts line={line} />
                            </li>
                        ))}
                    </ul>
                </details>
            )}
        </li>
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
