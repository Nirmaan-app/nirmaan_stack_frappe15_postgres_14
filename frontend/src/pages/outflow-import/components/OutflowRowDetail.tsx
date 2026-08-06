// src/pages/outflow-import/components/OutflowRowDetail.tsx

import { useFrappeGetCall } from "frappe-react-sdk";
import { Link } from "react-router-dom";
import { TailSpin } from "react-loader-spinner";

import { Badge } from "@/components/ui/badge";
import {
    OutflowImportRow,
    OutflowRowCandidates,
} from "@/types/NirmaanStack/OutflowImportBatch";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";

import { ROW_SETTLED, ROW_SKIPPED, isOpen } from "../outflowImportStatus";
import { SettleExpensePanel } from "./SettleExpensePanel";

interface Props {
    row: OutflowImportRow;
    onSettle: (
        row: OutflowImportRow,
        target: { doctype: string; name: string }
    ) => Promise<void>;
    onCreate: (
        row: OutflowImportRow,
        payload: {
            doctype: string;
            expense_type: string;
            project?: string;
            description?: string;
            vendor?: string;
        }
    ) => Promise<void>;
}

/**
 * The expanded view of one bank row: what it matched, and what it COULD match.
 *
 * Candidates are fetched here, per row, on expand -- not bundled into the batch payload. They are
 * only ever looked at for the row being worked on, and shipping every row's candidate set would
 * make the review payload an order of magnitude larger for information nobody reads.
 */
export const OutflowRowDetail = ({ row, onSettle, onCreate }: Props) => {
    // A skipped row has no decision left to make, so its candidates are not worth a round trip.
    const shouldFetch = row.row_status !== ROW_SKIPPED;
    const { data, isLoading } = useFrappeGetCall<{ message: OutflowRowCandidates }>(
        "nirmaan_stack.api.outflow_import.review.get_row_candidates",
        { row: row.name },
        shouldFetch ? undefined : null
    );

    const candidates = data?.message;

    return (
        <div className="space-y-4">
            {row.outcome_note && (
                <p className="rounded-md bg-background p-3 text-sm">{row.outcome_note}</p>
            )}
            {row.skip_reason && (
                <p className="rounded-md bg-background p-3 text-sm text-muted-foreground">
                    Skipped: {row.skip_reason}
                </p>
            )}

            <div className="grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
                <Detail label="Transfer id" value={row.transfer_id} mono />
                <Detail label="Bank account" value={row.bank_account || "--"} mono />
                <Detail label="IFSC" value={row.ifsc || "--"} mono />
                <Detail
                    label="Bank charges"
                    value={formatToRoundedIndianRupee(row.service_charge + row.service_tax)}
                />
            </div>

            {row.matches.length > 0 && (
                <Section title={`Matched ${row.matches.length === 1 ? "payment" : "payments"}`}>
                    <ul className="space-y-1">
                        {row.matches.map((m) => (
                            <li key={m.target_name} className="flex items-center gap-2 text-sm">
                                <Link
                                    to={`/project-payments/${m.target_name}`}
                                    className="font-medium text-primary underline underline-offset-2"
                                >
                                    {m.target_name}
                                </Link>
                                <span className="tabular-nums text-muted-foreground">
                                    {formatToRoundedIndianRupee(m.target_amount)}
                                </span>
                                <Badge variant="outline" className="text-[10px]">
                                    {m.match_basis}
                                </Badge>
                            </li>
                        ))}
                    </ul>
                </Section>
            )}

            {shouldFetch && isLoading && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <TailSpin color="#D03B45" height={14} width={14} /> Looking for candidates...
                </div>
            )}

            {candidates && (
                <div className="grid gap-4 lg:grid-cols-2">
                    <Section title="Vendor">
                        {candidates.vendor_candidates.length ? (
                            <>
                                {/* Ambiguity is SURFACED, never resolved. One bank account can
                                    belong to several legally distinct companies, and nothing in a
                                    statement separates them. */}
                                {candidates.vendor_ambiguous && (
                                    <p className="mb-2 text-xs text-amber-700">
                                        More than one vendor matches. Pick one when settling.
                                    </p>
                                )}
                                <ul className="space-y-1 text-sm">
                                    {candidates.vendor_candidates.map((v) => (
                                        <li key={v.vendor}>
                                            <span className="font-medium">{v.vendor_name}</span>{" "}
                                            <span className="text-xs text-muted-foreground">
                                                {v.reasons.join(", ")}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            </>
                        ) : (
                            <p className="text-sm text-muted-foreground">
                                No vendor matches this beneficiary or bank account.
                            </p>
                        )}
                    </Section>

                    <Section title="Approved expenses at this amount">
                        {candidates.expense_candidates.length ? (
                            <ul className="space-y-1 text-sm">
                                {candidates.expense_candidates.map((e) => (
                                    <li key={e.name}>
                                        <span className="font-medium">{e.name}</span>{" "}
                                        <span className="tabular-nums text-muted-foreground">
                                            {formatToRoundedIndianRupee(e.amount)}
                                        </span>
                                        <p className="text-xs text-muted-foreground">
                                            {e.reasons.join(", ")}
                                        </p>
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <p className="text-sm text-muted-foreground">
                                No approved expense matches this amount.
                            </p>
                        )}
                    </Section>
                </div>
            )}

            {/* The settle panel appears only while a row still needs a decision. A Reconciled row
                already corresponds to a recorded payment -- offering to book an expense for it too
                would be an invitation to double-count the same money. */}
            {isOpen(row.row_status) && (
                <SettleExpensePanel
                    row={row}
                    candidates={candidates}
                    onSettle={(target) => onSettle(row, target)}
                    onCreate={(payload) => onCreate(row, payload)}
                />
            )}

            {row.row_status === ROW_SETTLED && (
                <p className="text-xs text-muted-foreground">
                    Settled. See the linked expense above.
                </p>
            )}
        </div>
    );
};

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div className="rounded-md border bg-background p-3">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {title}
        </p>
        {children}
    </div>
);

const Detail = ({ label, value, mono }: { label: string; value: string; mono?: boolean }) => (
    <div>
        <p className="uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className={mono ? "font-mono" : ""}>{value}</p>
    </div>
);
