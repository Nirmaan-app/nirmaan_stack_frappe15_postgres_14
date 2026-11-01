import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
    AlertDialog,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogFooter, // Use Footer for better layout
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ProjectPayments } from "@/types/NirmaanStack/ProjectPayments"; // Assuming type path
import formatToIndianRupee, { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { parseNumber } from "@/utils/parseNumber";
import { TailSpin } from 'react-loader-spinner';
import { DIALOG_ACTION_TYPES, DialogActionType } from '../constants';
import { computeSplit, isAmountKeystroke, isSplittable } from '../paymentSplit';
import { usePaymentTdsForecasts } from '../../hooks/usePaymentTdsForecasts';
import { toTdsForecast } from '../../tdsPreview';
import { TDS_BORNE_BY } from '@/types/NirmaanStack/PaymentTDSDeduction';
import { isChequePayment } from '../../paymentMode';
import { formatDate } from '@/utils/FormatDate';
import { PaymentSummaryBlock, usePaymentSummary } from '../../components/PaymentSummaryBlock';
import { ExpenseApprovalDetails, useExpenseApprovalDetail } from './ExpenseApprovalDetails';
import { approvalBlocked, type ApprovalStage } from '../expenseApprovalDetail';
import { approveAllLabel, rejectAllLabel, rejectTitle, type ChequeApproval } from '@/utils/cheques/chequeApproval';
import { ChequeApprovalBlock } from './ChequeApprovalBlock';
import { ChequeRejectBlock } from './ChequeRejectBlock';
import { MonthLimitNotice, monthTickNeeded } from '@/components/reimbursements/MonthLimitNotice';
import { useMonthTotals } from '@/components/reimbursements/useMonthTotals';

interface PaymentActionDialogProps {
    isOpen: boolean;
    onOpenChange: (isOpen: boolean) => void;
    type: DialogActionType;
    paymentData: ProjectPayments | null;
    vendorName?: string; // Pass pre-fetched vendor name
    /** `reason` is sent by a cheque reject (#1481) and an expense reject (#1497); both require one. */
    onSubmit: (actionType: DialogActionType, amount: number, reason?: string) => Promise<void>;
    isLoading: boolean; // Loading state passed from parent
    /**
     * Let the approver approve LESS than was requested (the CEO gate).
     *
     * The balance is never discarded — the backend splits the payment, leaving the difference as
     * its own pending payment plus its own PO term row. The dialog says so explicitly, because
     * "approve 3 of 5" reads like "reject 2" unless the screen states otherwise.
     */
    allowPartial?: boolean;
    /**
     * Whether approving HERE is the transition into `Approved` — i.e. the CEO gate.
     *
     * ⚠️ IT DRIVES THE TENSE, NOT THE NUMBERS. The figures are identical either way; what differs
     * is whether the tax comes off on this click or at the next approval. A Project Lead moving a
     * payment to `CEO Pending` withholds nothing, and a dialog that says otherwise beside a button
     * that does nothing of the sort is how somebody concludes their click deducted it.
     */
    withholdsTdsNow?: boolean;
    /** Which approval this is -- the expense details block says where the click lands it. */
    stage?: ApprovalStage;
    /**
     * The Payment cheque this payment is on (#1480, #1481, spec #1477), when the decision goes through it:
     * the dialog then lists every payment on the cheque and approves, or rejects, them all together (a
     * reject also cancels the cheque and asks for a reason). Undefined otherwise.
     */
    chequeApproval?: ChequeApproval | null;
    /** True while `chequeApproval` is still loading for a payment that is approved through its cheque. */
    chequeApprovalLoading?: boolean;
}

export const PaymentActionDialog: React.FC<PaymentActionDialogProps> = ({
    isOpen,
    onOpenChange,
    type,
    paymentData,
    vendorName = "the vendor", // Default text
    onSubmit,
    isLoading,
    allowPartial = false,
    withholdsTdsNow = false,
    stage = "lead",
    chequeApproval,
    chequeApprovalLoading = false,
}) => {
    const [amountInput, setAmountInput] = useState<string>("");

    const requestedAmount = parseNumber(paymentData?.amount);
    // `isSplittable` is what keeps a REFUND approvable. A negative payment (a credit raised after
    // a negative-rate amendment) cannot be split, and showing the amount box on one leaves the
    // Confirm button permanently disabled. Unsplittable => the plain full-approve confirmation,
    // byte-identical to the pre-partial-approval behaviour.
    // A cheque is written for its full amount, so it is approved in full or rejected -- never
    // split (the server refuses it too).
    const isCheque = isChequePayment(paymentData);
    // The queue holds three ledgers and only a Project Payment has a Mode of Payment; an expense row
    // carries a blank one. `doctype` rides every queue row (`ApprovalQueueRow`).
    const ledger = (paymentData as { doctype?: string } | null)?.doctype;
    const showMode = !ledger || ledger === "Project Payments";
    const isExpense = !showMode;
    // Where this PO / WO's money already stands (owner, 2026-09-21). A payment row only -- an
    // expense has no parent order, so the hook stays idle and the block renders nothing.
    const { summary, isLoading: summaryLoading } = usePaymentSummary(
        showMode && isOpen ? paymentData?.document_type : null,
        showMode && isOpen ? paymentData?.document_name : null,
        paymentData?.name
    );
    // A PAYMENT only: an expense has no parent to split against, and the CEO's expense approve
    // writes the full amount whatever the box says -- so the box must not be offered there.
    const isPartialApprove =
        allowPartial && !isExpense && !isCheque && type === DIALOG_ACTION_TYPES.APPROVE && isSplittable(requestedAmount);
    // One cheque, one decision (#1480, #1481): approving a payment on a Payment cheque approves every payment
    // on it; rejecting one rejects every payment on it and cancels the cheque, with a required reason.
    const chequeLoading = chequeApprovalLoading && !chequeApproval;
    const throughCheque = type === DIALOG_ACTION_TYPES.APPROVE && !!chequeApproval;
    const rejectsCheque = type === DIALOG_ACTION_TYPES.REJECT && !!chequeApproval;
    const [reason, setReason] = useState("");
    // An expense reject needs a reason too: the decision call refuses one without (#1497).
    const rejectsExpense = type === DIALOG_ACTION_TYPES.REJECT && isExpense;
    // A reimbursement's expense (ADR-0040): the claim is rejected too, and its raiser sees the reason.
    const isReimbursement = (paymentData as { source_type?: string } | null)?.source_type === "Reimbursement";
    // Approving one shows its claimant's month total; above the monthly limit the box must be ticked first
    // (ADR-0040 Amendment B). The tick is the screen's: the decision call takes none.
    const approvesReimbursement = isOpen && isReimbursement && type === DIALOG_ACTION_TYPES.APPROVE && !!paymentData;
    const month = useMonthTotals(approvesReimbursement ? { expenses: [paymentData.name] } : null);
    const monthRow = approvesReimbursement ? month.byExpense.get(paymentData.name) : undefined;
    const [acknowledged, setAcknowledged] = useState(false);
    const monthBlocked = approvesReimbursement
        && (month.isLoading || (monthTickNeeded(monthRow, month.failed) && !acknowledged));
    const needsReason = rejectsCheque || rejectsExpense;
    const chequeBlocked =
        chequeLoading || (throughCheque && !!chequeApproval?.problem) || (needsReason && !reason.trim());
    // An Office Rent expense whose request does not name the landlord cannot be approved (the server
    // refuses it); the details block says so, and Confirm is disabled (spec #1522 review batch 2).
    const { data: expenseDetail } = useExpenseApprovalDetail(isExpense ? ledger : null, paymentData?.name, isOpen);
    const expenseBlocked = !!approvalBlocked(expenseDetail?.message, type === DIALOG_ACTION_TYPES.APPROVE);

    // Reset amount input when payment data changes or dialog opens/closes
    useEffect(() => {
        if (paymentData) {
            setAmountInput(String(paymentData.amount || ""));
        } else {
            setAmountInput(""); // Clear if no data
        }
        setReason("");
        setAcknowledged(false);
    }, [paymentData, isOpen]); // Depend on isOpen to reset on reopen

    // All the boundary rules live in the pure helper so they can be tested — there is no DOM
    // test environment in this repo, so anything decided inline here would be untestable.
    const split = useMemo(
        () => computeSplit(requestedAmount, amountInput),
        [requestedAmount, amountInput]
    );

    /**
     * What tax the approval will withhold.
     *
     * ⚠️ IT FOLLOWS THE AMOUNT BEING APPROVED, NOT THE AMOUNT REQUESTED. A partial approval splits
     * the payment first, so the tax is taken on the figure in the box — forecasting off
     * `paymentData.amount` would be wrong on exactly the row somebody is looking hardest at.
     * `null` for a Procurement Order, a vendor with no rate, or a refund, and the panel then
     * renders no tax lines at all rather than a row of zeroes.
     */
    const approvingAmount = isPartialApprove && split.valid ? split.approved : requestedAmount;
    // The server works the forecast out (story 59): the vendor's rate today and the rule approval uses.
    // A GST payment, a PO payment and a vendor with no rate get none.
    const forecastAsks = useMemo(
        () => (isOpen && paymentData?.name && approvingAmount > 0
            ? [{ name: paymentData.name, amount: approvingAmount }]
            : null),
        [isOpen, paymentData?.name, approvingAmount]
    );
    const { forecasts } = usePaymentTdsForecasts(forecastAsks);
    const serverForecast = paymentData ? forecasts[paymentData.name] : undefined;
    const tds = toTdsForecast(serverForecast);
    // Miscellaneous / Transportation-only Work Order: the tax is paid on top, the payment stays whole.
    const companyBorne = serverForecast?.borne_by === TDS_BORNE_BY.COMPANY;

    const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (isAmountKeystroke(e.target.value)) {
            setAmountInput(e.target.value);
        }
    };

    const handleConfirm = useCallback(async () => {
        if (!paymentData) return;
        if (isPartialApprove && !split.valid) return;
        if (chequeBlocked || monthBlocked) return;

        // Non-partial paths send the untouched requested amount, exactly as before.
        await onSubmit(type, isPartialApprove ? split.approved : requestedAmount, needsReason ? reason.trim() : undefined);
        // Parent component will handle closing the dialog via onOpenChange after successful submission if needed

    }, [paymentData, type, isPartialApprove, split, requestedAmount, onSubmit, chequeBlocked, monthBlocked, needsReason, reason]);

    const renderTitle = () => {
        if (!paymentData) return null;

        if (isExpense) {
            // No vendor and no PO / WO number on an expense -- the old sentence read
            // "... to the vendor for #?". The details block below names everything.
            return (
                <>
                    {type === DIALOG_ACTION_TYPES.REJECT ? "Reject" : "Approve"} this expense of{' '}
                    <span className="font-semibold text-primary">{formatToRoundedIndianRupee(paymentData.amount)}</span>?
                </>
            );
        }

        if (rejectsCheque && chequeApproval) {
            return <>{rejectTitle(chequeApproval)}</>;
        }

        if (throughCheque || chequeLoading) {
            return <>{type === DIALOG_ACTION_TYPES.REJECT ? "Reject" : "Approve"} payment {paymentData.name}</>;
        }

        if (isPartialApprove) {
            // The amount is editable here, so the title must NOT assert it — the figure being
            // approved is whatever is in the box, and it is shown next to the box.
            return (
                <>
                    Approve payment to <span className="font-semibold">{vendorName}</span> for{' '}
                    <i>#{paymentData.document_name}</i>
                </>
            );
        }

        switch (type) {
            case DIALOG_ACTION_TYPES.APPROVE:
            case DIALOG_ACTION_TYPES.REJECT:
                return (
                    <>
                        Are you sure you want to {type} the payment of{' '}
                        <span className="font-semibold text-primary">{formatToRoundedIndianRupee(paymentData.amount)}</span> to{' '}
                        <span className="font-semibold">{vendorName}</span> for{' '}
                        <i>#{paymentData.document_name}</i>?
                    </>
                );
            default:
                return "Confirm Action";
        }
    };

    return (
        <AlertDialog open={isOpen} onOpenChange={onOpenChange}>
            <AlertDialogContent
                className={`${throughCheque || rejectsCheque || chequeLoading ? "sm:max-w-3xl" : isExpense ? "sm:max-w-lg" : "sm:max-w-md"} max-h-[90vh] overflow-y-auto`}
            >
                <AlertDialogHeader>
                    <AlertDialogTitle className="text-center sm:text-left">
                        {renderTitle()}
                    </AlertDialogTitle>
                </AlertDialogHeader>

                {paymentData && chequeLoading && (
                    <div className="flex justify-center py-6">
                        <TailSpin width={30} height={30} color="red" />
                    </div>
                )}
                {paymentData && throughCheque && chequeApproval && (
                    <ChequeApprovalBlock approval={chequeApproval} openedPayment={paymentData.name} stage={stage} />
                )}
                {paymentData && rejectsCheque && chequeApproval && (
                    <ChequeRejectBlock
                        approval={chequeApproval}
                        openedPayment={paymentData.name}
                        reason={reason}
                        onReasonChange={setReason}
                        disabled={isLoading}
                    />
                )}
                {paymentData && showMode && !throughCheque && !rejectsCheque && !chequeLoading && (
                    <PaymentSummaryBlock summary={summary} isLoading={summaryLoading} thisAmount={requestedAmount} />
                )}
                {paymentData && isExpense && ledger && (
                    <ExpenseApprovalDetails
                        doctype={ledger}
                        name={paymentData.name}
                        isOpen={isOpen}
                        stage={stage}
                        approving={type === DIALOG_ACTION_TYPES.APPROVE}
                    />
                )}
                {approvesReimbursement && (
                    <MonthLimitNotice
                        row={monthRow}
                        isLoading={month.isLoading}
                        failed={month.failed}
                        place="payments"
                        acknowledged={acknowledged}
                        onAcknowledgedChange={setAcknowledged}
                        disabled={isLoading}
                    />
                )}
                {paymentData && rejectsExpense && (
                    <div>
                        <label htmlFor="expense-reject-reason" className="text-xs font-medium text-muted-foreground">
                            Reason <span className="text-red-600">*</span>
                        </label>
                        <Textarea
                            id="expense-reject-reason"
                            rows={3}
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            disabled={isLoading}
                            required
                            placeholder={isReimbursement ? "Why is this reimbursement rejected?" : "Why is this expense rejected?"}
                        />
                        {isReimbursement && (
                            <p className="mt-1 text-[11px] text-muted-foreground">
                                The claim is rejected too, and the person who raised it sees this reason.
                            </p>
                        )}
                    </div>
                )}
                {paymentData && showMode && type === DIALOG_ACTION_TYPES.APPROVE && !throughCheque && !chequeLoading && (
                    <div className="rounded-md border divide-y text-sm">
                        {/* Requested — the figure the payment was raised for. */}
                        <div className="flex items-baseline justify-between px-3 py-2">
                            <span className="text-muted-foreground">Requested</span>
                            <span className="font-medium tabular-nums">
                                {formatToIndianRupee(requestedAmount)}
                            </span>
                        </div>

                        {/* Mode of Payment -- a header row in the "Vendor receives" band, then the
                            cheque's own rows, plain like "Requested". Online is the header alone. */}
                        {showMode && (
                            <div className="flex items-baseline justify-between bg-muted/40 px-3 py-2">
                                <span className="font-semibold">Mode of Payment</span>
                                <span
                                    className={`font-semibold ${
                                        isCheque
                                            ? "text-amber-700 dark:text-amber-400"
                                            : "text-sky-700 dark:text-sky-400"
                                    }`}
                                >
                                    {isCheque ? "Cheque" : "Online"}
                                </span>
                            </div>
                        )}
                        {showMode && isCheque && (
                            <>
                                <div className="flex items-baseline justify-between px-3 py-2">
                                    <span className="text-muted-foreground">Cheque No</span>
                                    <span className="font-medium tabular-nums">{paymentData.cheque_no}</span>
                                </div>
                                <div className="flex items-baseline justify-between px-3 py-2">
                                    <span className="text-muted-foreground">Cheque Date</span>
                                    <span className="font-medium tabular-nums">
                                        {paymentData.cheque_date ? formatDate(paymentData.cheque_date) : "--"}
                                    </span>
                                </div>
                            </>
                        )}

                        {isPartialApprove && (
                            <div className="px-3 py-2">
                                <div className="flex items-center justify-between gap-3">
                                    <label htmlFor="approved-amount" className="font-medium whitespace-nowrap">
                                        Approving now
                                    </label>
                                    <Input
                                        id="approved-amount"
                                        type="text"
                                        inputMode="decimal"
                                        onChange={handleAmountChange}
                                        value={amountInput}
                                        className="h-8 w-40 text-right tabular-nums"
                                        disabled={isLoading}
                                        aria-invalid={!split.valid}
                                        aria-describedby="approved-amount-help"
                                    />
                                </div>
                                <p id="approved-amount-help" className="mt-1.5 text-xs">
                                    {!split.valid ? (
                                        <span className="text-destructive">{split.reason}</span>
                                    ) : split.isPartial ? (
                                        <span className="text-amber-700 dark:text-amber-400">
                                            The balance of{' '}
                                            <span className="font-semibold tabular-nums">
                                                {formatToRoundedIndianRupee(split.remainder)}
                                            </span>{' '}
                                            stays pending as a new payment, and is added to{' '}
                                            <i>#{paymentData.document_name}</i> as a separate payment term.
                                            Nothing is written off.
                                        </span>
                                    ) : (
                                        <span className="text-muted-foreground">
                                            Approving the full requested amount.
                                        </span>
                                    )}
                                </p>
                            </div>
                        )}

                        {/* Tax lines — absent entirely when nothing is withheld (a Procurement
                            Order, a vendor with no rate, a refund), because a row of zeroes on
                            every other payment trains people to stop reading this panel. */}
                        {tds && (
                            <>
                                <div className="flex items-baseline justify-between px-3 py-2">
                                    <span className="text-muted-foreground">
                                        TDS @ {tds.ratePct}%{companyBorne && " · paid by company"}
                                    </span>
                                    {companyBorne ? (
                                        <span className="font-medium tabular-nums">
                                            {formatToIndianRupee(tds.tds)}
                                        </span>
                                    ) : (
                                        <span className="font-medium tabular-nums text-rose-600 dark:text-rose-400">
                                            − {formatToIndianRupee(tds.tds)}
                                        </span>
                                    )}
                                </div>
                                <div className="flex items-baseline justify-between bg-muted/40 px-3 py-2">
                                    <span className="font-semibold">Vendor receives</span>
                                    <span className="font-semibold tabular-nums text-green-700 dark:text-green-400">
                                        {formatToIndianRupee(tds.net)}
                                    </span>
                                </div>
                            </>
                        )}
                    </div>
                )}

                {showMode && isCheque && type === DIALOG_ACTION_TYPES.APPROVE && !throughCheque && !chequeLoading && (
                    <p className="text-xs text-muted-foreground">
                        Approved in full only. Once fully approved it goes straight to Reconciliation Pending.
                    </p>
                )}

                {tds && !throughCheque && !chequeLoading && (
                    <p className="text-xs text-muted-foreground">
                        {companyBorne
                            ? withholdsTdsNow
                                ? "The vendor receives the full amount; TDS is recorded when you approve and paid by the company on top."
                                : "The vendor receives the full amount; TDS is recorded at CEO approval and paid by the company on top."
                            : withholdsTdsNow
                                ? "TDS is withheld when you approve, and recorded against the work order."
                                : "TDS is withheld at CEO approval, not on this step."}
                    </p>
                )}

                <AlertDialogFooter className="mt-4">
                    {isLoading ? (
                        <div className="flex justify-center w-full">
                            <TailSpin width={30} height={30} color="red" />
                        </div>
                    ) : (
                        <>
                            <AlertDialogCancel disabled={isLoading}>Cancel</AlertDialogCancel>
                            <Button
                                disabled={isLoading || chequeBlocked || expenseBlocked || monthBlocked || (isPartialApprove && !split.valid)}
                                onClick={handleConfirm}
                                variant={needsReason ? "destructive" : "default"}
                            >
                                {throughCheque && chequeApproval
                                    ? approveAllLabel(chequeApproval)
                                    : rejectsCheque && chequeApproval
                                    ? rejectAllLabel(chequeApproval)
                                    : chequeLoading
                                    ? type === DIALOG_ACTION_TYPES.REJECT ? "Reject" : "Approve"
                                    : isPartialApprove && split.valid && split.isPartial
                                    ? `Approve ${formatToRoundedIndianRupee(split.approved)}`
                                    : `Confirm ${type}`}
                            </Button>
                        </>
                    )}
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
};
