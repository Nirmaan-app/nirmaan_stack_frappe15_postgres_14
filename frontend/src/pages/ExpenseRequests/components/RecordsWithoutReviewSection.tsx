// src/pages/ExpenseRequests/components/RecordsWithoutReviewSection.tsx
//
// Expense Packages → "Records without review" (spec #1494, #1498): the role profiles whose expense
// requests are approved on submit, with no Reviewer. Admin always records without review and is
// not offered. Only profiles that can raise at least one type are offered; the server refuses any
// other (`Expense Settings` validate) and drops a ticked profile that has lost all its types.
// It skips the Reviewer, never the amount rule.

import React, { useState } from "react";
import { useFrappeGetCall, useFrappePostCall } from "frappe-react-sdk";

import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/components/ui/use-toast";
import { getFrappeError } from "@/utils/frappeErrors";

/** The SWR key, so Expense Packages refreshes the offer after a type's roles change. */
export const RECORDS_WITHOUT_REVIEW_KEY = "expense_records_without_review";

interface RecordsWithoutReview {
    /** The profiles offered: those that can raise at least one type, Admin left out. */
    role_profiles: string[];
    /** The ticked ones. */
    records_without_review: string[];
}

/** "Nirmaan HR Lead Profile" -> "HR Lead". */
const shortProfile = (p: string) => p.replace(/^Nirmaan /, "").replace(/ Profile$/, "");

export const RecordsWithoutReviewSection: React.FC = () => {
    const { data, mutate, isLoading } = useFrappeGetCall<{ message: RecordsWithoutReview }>(
        "nirmaan_stack.api.expense_requests.expense_settings.get_records_without_review",
        undefined,
        RECORDS_WITHOUT_REVIEW_KEY
    );
    const { call: save } = useFrappePostCall(
        "nirmaan_stack.api.expense_requests.expense_settings.set_records_without_review"
    );
    const [saving, setSaving] = useState(false);

    const offered = data?.message?.role_profiles ?? [];
    const ticked = data?.message?.records_without_review ?? [];

    const toggle = async (profile: string, on: boolean) => {
        const next = on ? [...ticked, profile] : ticked.filter((p) => p !== profile);
        setSaving(true);
        try {
            const res = await save({ role_profiles: next });
            await mutate({ message: res.message }, { revalidate: false });
            toast({
                title: on ? "Records without review" : "Sent for review again",
                description: on
                    ? `${shortProfile(profile)} expenses are now approved on submit.`
                    : `${shortProfile(profile)} expenses now go to a Reviewer.`,
                variant: "success",
            });
        } catch (e) {
            toast({ title: "Could not save", description: getFrappeError(e), variant: "destructive" });
        } finally {
            setSaving(false);
        }
    };

    return (
        <section className="rounded border p-3">
            <h3 className="text-sm font-semibold">Records without review</h3>
            <p className="text-xs text-muted-foreground">
                Expenses raised by these profiles are approved on submit, with no Reviewer. Admin
                always records without review. The amount rule still applies: from ₹15,000 an Admin
                approves next, and above ₹50,000 the CEO.
            </p>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
                {isLoading && <span className="text-xs text-muted-foreground">Loading…</span>}
                {!isLoading && offered.length === 0 && (
                    <span className="text-xs text-muted-foreground">
                        No profile can raise an expense type yet.
                    </span>
                )}
                {offered.map((p) => (
                    <label key={p} className="flex items-center gap-2 text-sm" title={p}>
                        <Checkbox
                            checked={ticked.includes(p)}
                            disabled={saving}
                            onCheckedChange={(v) => toggle(p, v === true)}
                        />
                        {shortProfile(p)}
                    </label>
                ))}
            </div>
        </section>
    );
};

export default RecordsWithoutReviewSection;
