import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radiogroup";
import formatToIndianRupee from "@/utils/FormatPrice";

import {
	chequeAmountFor,
	PAYMENT_MODE_CHEQUE,
	PAYMENT_MODE_ONLINE,
	PaymentMode,
	PaymentModeValue,
} from "../paymentMode";
import type { TdsForecast } from "../tdsForecast";

interface Props {
	value: PaymentModeValue;
	onChange: (value: PaymentModeValue) => void;
	/** The amount being requested, for the "write the cheque for" line. Omit to hide the line. */
	amount?: number;
	/** The Work Order's TDS forecast on `amount` (`forecastTds`), or null when nothing is withheld. */
	tds?: TdsForecast | null;
	/** Miscellaneous / Transportation-only Work Order: the company pays the tax on top. */
	companyBorne?: boolean;
	disabled?: boolean;
}

/** Online / Cheque, plus the cheque's number and date. Shared by every Project Payment request dialog. */
export const PaymentModeFields = ({ value, onChange, amount, tds = null, companyBorne = false, disabled }: Props) => {
	const isCheque = value.mode === PAYMENT_MODE_CHEQUE;
	const chequeAmount = amount !== undefined ? chequeAmountFor(amount, tds) : undefined;

	return (
		<div className="space-y-2 rounded-md border px-3 py-2">
			<div className="flex items-center gap-4">
				<span className="text-sm font-medium">Mode of Payment</span>
				<RadioGroup
					value={value.mode}
					onValueChange={(mode) => onChange({ ...value, mode: mode as PaymentMode })}
					className="flex gap-4"
					disabled={disabled}
				>
					<div className="flex items-center gap-1.5">
						<RadioGroupItem value={PAYMENT_MODE_ONLINE} id="pay-mode-online" />
						<Label htmlFor="pay-mode-online">Online</Label>
					</div>
					<div className="flex items-center gap-1.5">
						<RadioGroupItem value={PAYMENT_MODE_CHEQUE} id="pay-mode-cheque" />
						<Label htmlFor="pay-mode-cheque">Cheque</Label>
					</div>
				</RadioGroup>
			</div>

			{isCheque && (
				<>
					<div className="grid grid-cols-2 gap-2">
						<div className="space-y-1">
							<Label htmlFor="cheque-no" className="text-xs">Cheque No</Label>
							<Input
								id="cheque-no"
								className="h-8"
								value={value.chequeNo}
								onChange={(e) => onChange({ ...value, chequeNo: e.target.value })}
								disabled={disabled}
							/>
						</div>
						<div className="space-y-1">
							<Label htmlFor="cheque-date" className="text-xs">Cheque Date</Label>
							<Input
								id="cheque-date"
								type="date"
								className="h-8"
								value={value.chequeDate}
								onChange={(e) => onChange({ ...value, chequeDate: e.target.value })}
								disabled={disabled}
							/>
						</div>
					</div>

					{chequeAmount !== undefined && chequeAmount > 0 && (
						<p className="text-xs">
							Cheque amount for this payment:{" "}
							<span className="font-semibold tabular-nums">{formatToIndianRupee(chequeAmount)}</span>
							{tds && !companyBorne && (
								<span className="text-muted-foreground">
									{" "}— after {formatToIndianRupee(tds.tds)} TDS ({tds.ratePct}%)
								</span>
							)}
							{tds && companyBorne && (
								<span className="text-muted-foreground"> — the company pays the TDS on top</span>
							)}
							.
						</p>
					)}
					<p className="text-[11px] text-muted-foreground">
						One cheque can cover several payments: use the same Cheque No on each. Once approved, a
						cheque payment goes straight to Reconciliation Pending.
					</p>
				</>
			)}
		</div>
	);
};
