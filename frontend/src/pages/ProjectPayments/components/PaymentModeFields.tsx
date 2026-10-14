import { type Dispatch, type SetStateAction, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useFrappeFileUpload } from "frappe-react-sdk";
import { AlertTriangle, Ban, Loader2 } from "lucide-react";

import { FROM_PHOTO_INPUT, FromPhotoTag } from "@/components/cheques/FromPhotoTag";
import { useChequePhotoReader, usePayeeVendorMismatch } from "@/components/cheques/useChequePhotoReader";
import { useExistingCheque } from "@/components/cheques/useExistingCheque";
import { CustomAttachment } from "@/components/helpers/CustomAttachment";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radiogroup";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import { CHEQUE_BANK, type ChequeBank } from "@/types/NirmaanStack/Cheques";
import { isFromPhoto, type ChequePhotoField } from "@/utils/cheques/chequePhoto";
import { chequeReportPath } from "@/utils/cheques/chequeReportLink";
import { newChequeDuplicateText } from "@/utils/cheques/paymentChequeActions";
import formatToIndianRupee from "@/utils/FormatPrice";
import { getFrappeError } from "@/utils/frappeErrors";

import {
	chequeAmountFor,
	chequeAmountHint,
	PAYMENT_MODE_CHEQUE,
	PAYMENT_MODE_ONLINE,
	PaymentMode,
	PaymentModeValue,
} from "../paymentMode";
import type { TdsForecast } from "../tdsForecast";

/** The cheque fields this form has: no payee box, the cheque is made out to the PO / WO's Vendor. */
const PHOTO_FIELDS: readonly ChequePhotoField[] = ["bank", "cheque_no", "cheque_date", "amount"];

interface Props {
	value: PaymentModeValue;
	/** The dialog's `useState` setter: the photo fills the fields after an await, so it takes updaters. */
	onChange: Dispatch<SetStateAction<PaymentModeValue>>;
	/** The amount being requested, for the "write the cheque for" line. Omit to hide the line. */
	amount?: number;
	/** The Work Order's TDS forecast on `amount` (`forecastTds`), or null when nothing is withheld. */
	tds?: TdsForecast | null;
	/** Miscellaneous / Transportation-only Work Order: the company pays the tax on top. */
	companyBorne?: boolean;
	/** The PO / Work Order's Vendor, whom the cheque is made out to: the photo's payee is checked against it. */
	vendor?: string;
	disabled?: boolean;
	/**
	 * `request` (default): a Request Payment dialog, Online or Cheque. `new_cheque`: Convert to Cheque /
	 * Link a new cheque on an existing payment (#1416): always Cheque, no mode choice, the refusal worded for it.
	 */
	purpose?: "request" | "new_cheque";
}

const Required = () => <span className="ml-0.5 text-red-500">*</span>;

/**
 * Online / Cheque. Shared by every Project Payment request dialog (the PO page's payment terms, the
 * Work Order page, Credits), and by Convert to Cheque / Link a new cheque in Transaction Details
 * (`purpose="new_cheque"`, #1416).
 *
 * Cheque mode (#1414, spec #1407) starts from the cheque's photo: it is uploaded, read, and what it
 * says fills the bank, number, date and amount, tagged "From photo". On Submit the server makes the
 * payment and a new Cheque with one line for it. A bank + number already recorded is shown here,
 * with a link to that Cheque, and the request stays disabled: the dialog asks `useDuplicateChequeOf` for
 * `isPaymentModeComplete`.
 */
export const PaymentModeFields = ({
	value,
	onChange,
	amount,
	tds = null,
	companyBorne = false,
	vendor,
	disabled,
	purpose = "request",
}: Props) => {
	const isRequest = purpose === "request";
	/** The soft warnings never block: what the user can still do. */
	const goAhead = isRequest ? "request" : "save";
	const isCheque = value.mode === PAYMENT_MODE_CHEQUE;
	const chequeAmount = amount !== undefined ? chequeAmountFor(amount, tds) : undefined;

	const { upload, loading: uploading } = useFrappeFileUpload();
	const [photoFile, setPhotoFile] = useState<File | null>(null);
	// A photo replaced while the first is still uploading or read must not land the first one's values.
	const uploadSession = useRef(0);
	const valueRef = useRef(value);
	valueRef.current = value;
	const reader = useChequePhotoReader<PaymentModeValue>(
		() => valueRef.current,
		(fill) => onChange((prev) => ({ ...prev, ...fill })),
		PHOTO_FIELDS,
	);
	const fromPhoto = (field: ChequePhotoField) => isFromPhoto(field, value, reader.photo);

	const photoPayee = isCheque ? reader.photo?.payee_name : undefined;
	const payeeMismatch = usePayeeVendorMismatch(photoPayee, vendor);
	const amountHint = isCheque && amount !== undefined ? chequeAmountHint(value.amount, amount, tds) : null;

	const existing = useExistingCheque(value.bank, value.bank_name, isCheque ? value.cheque_no : "");

	const set = (patch: Partial<PaymentModeValue>) => onChange((prev) => ({ ...prev, ...patch }));

	const handlePhoto = async (file: File | null) => {
		const session = ++uploadSession.current;
		reader.cancel();
		setPhotoFile(file);
		set({ attachment: "", photoBusy: !!file });
		if (!file) return;
		try {
			// Uploaded unattached, as Add Cheque does: saving the Cheque attaches it.
			const uploaded = await upload(file, { isPrivate: true });
			if (session !== uploadSession.current) return;
			set({ attachment: uploaded.file_url });
			// A replaced photo is read again; what only the old one said is cleared.
			const current = await reader.read(uploaded.file_url);
			if (current && session === uploadSession.current) set({ photoBusy: false });
		} catch (e) {
			if (session !== uploadSession.current) return;
			setPhotoFile(null);
			set({ photoBusy: false });
			toast({ title: "Could not upload the photo", description: getFrappeError(e), variant: "destructive" });
		}
	};

	return (
		<div className="space-y-2 rounded-md border px-3 py-2">
			{isRequest && (
				<div className="flex items-center gap-4">
					<span className="text-sm font-medium">Mode of Payment</span>
					<RadioGroup
						value={value.mode}
						onValueChange={(mode) => set({ mode: mode as PaymentMode })}
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
			)}

			{isCheque && (
				<>
					<div className="space-y-1">
						<Label className="text-xs">Cheque photo<Required /></Label>
						<div className="flex flex-wrap items-center gap-2">
							<CustomAttachment
								selectedFile={value.attachment || value.photoBusy ? photoFile : null}
								onFileSelect={handlePhoto}
								acceptedTypes={["image/*", "application/pdf"]}
								label="Upload cheque photo"
								disabled={disabled}
							/>
							{(uploading || reader.reading) && (
								<span className="flex items-center gap-1 text-xs text-muted-foreground">
									<Loader2 className="h-4 w-4 animate-spin" />
									{uploading ? "Uploading..." : "Reading the photo..."}
								</span>
							)}
						</div>
						{!value.attachment && !value.photoBusy && (
							<p className="text-[11px] text-muted-foreground">
								Upload the cheque's photo first: what can be read off it is filled in and tagged "From photo".
							</p>
						)}
					</div>

					<div className="grid grid-cols-2 gap-2">
						<div className="space-y-1">
							<Label className="text-xs">Bank<Required />{fromPhoto("bank") && <FromPhotoTag />}</Label>
							<Select value={value.bank} onValueChange={(bank) => set({ bank: bank as ChequeBank })} disabled={disabled}>
								<SelectTrigger className={cn("h-8", fromPhoto("bank") && FROM_PHOTO_INPUT)}>
									<SelectValue placeholder="Choose the bank" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value={CHEQUE_BANK.ICICI}>ICICI Bank</SelectItem>
									<SelectItem value={CHEQUE_BANK.OTHERS}>Others</SelectItem>
								</SelectContent>
							</Select>
						</div>
						{value.bank === CHEQUE_BANK.OTHERS && (
							<div className="space-y-1">
								<Label htmlFor="cheque-bank-name" className="text-xs">
									Bank name<Required />{fromPhoto("bank") && <FromPhotoTag />}
								</Label>
								<Input
									id="cheque-bank-name"
									className={cn("h-8", fromPhoto("bank") && FROM_PHOTO_INPUT)}
									placeholder="e.g. HDFC Bank"
									value={value.bank_name}
									onChange={(e) => set({ bank_name: e.target.value })}
									disabled={disabled}
								/>
							</div>
						)}
						<div className="space-y-1">
							<Label htmlFor="cheque-no" className="text-xs">
								Cheque No<Required />{fromPhoto("cheque_no") && <FromPhotoTag />}
							</Label>
							<Input
								id="cheque-no"
								inputMode="numeric"
								className={cn("h-8", fromPhoto("cheque_no") && FROM_PHOTO_INPUT)}
								value={value.cheque_no}
								onChange={(e) => set({ cheque_no: e.target.value })}
								disabled={disabled}
							/>
						</div>
						<div className="space-y-1">
							<Label htmlFor="cheque-date" className="text-xs">
								Cheque Date<Required />{fromPhoto("cheque_date") && <FromPhotoTag />}
							</Label>
							<Input
								id="cheque-date"
								type="date"
								className={cn("h-8", fromPhoto("cheque_date") && FROM_PHOTO_INPUT)}
								value={value.cheque_date}
								onChange={(e) => set({ cheque_date: e.target.value })}
								disabled={disabled}
							/>
						</div>
						<div className="space-y-1">
							<Label htmlFor="cheque-amount" className="text-xs">
								Amount (₹)<Required />{fromPhoto("amount") && <FromPhotoTag />}
							</Label>
							<Input
								id="cheque-amount"
								type="number"
								min={0}
								step="0.01"
								className={cn("h-8", fromPhoto("amount") && FROM_PHOTO_INPUT)}
								value={value.amount}
								onChange={(e) => set({ amount: e.target.value })}
								disabled={disabled}
							/>
						</div>
					</div>

					{chequeAmount !== undefined && chequeAmount > 0 && (
						<p className="text-xs">
							Write the cheque for{" "}
							<span className="font-semibold tabular-nums">{formatToIndianRupee(chequeAmount)}</span>
							{tds && !companyBorne && (
								<span className="text-muted-foreground">
									{" "}after {formatToIndianRupee(tds.tds)} TDS ({tds.ratePct}%)
								</span>
							)}
							{tds && companyBorne && (
								<span className="text-muted-foreground"> — the company pays the TDS on top</span>
							)}
							.
						</p>
					)}
					{amountHint && (
						<p className="flex items-start gap-1.5 text-xs text-amber-700">
							<AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
							{amountHint.kind === "gross"
								? `The cheque is for the gross amount, ${formatToIndianRupee(amountHint.gross)}. ` +
									`Write it for ${formatToIndianRupee(amountHint.expected)}, after ${formatToIndianRupee(amountHint.tds)} TDS. You can still ${goAhead} it.`
								: `The cheque is for ${formatToIndianRupee(Number(value.amount))}, but this payment's cheque should be ` +
									`${formatToIndianRupee(amountHint.expected)}. Check the amount; you can still ${goAhead} it.`}
						</p>
					)}
					{photoPayee && (
						<p className="text-xs text-muted-foreground">
							Payee on the photo: <span className="font-medium text-foreground">{photoPayee}</span>
							<FromPhotoTag />
						</p>
					)}
					{payeeMismatch && (
						<p className="flex items-start gap-1.5 text-xs text-amber-700">
							<AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
							The payee on the photo ({payeeMismatch.payee}) does not look like {payeeMismatch.vendorName}, this
							order's Vendor. Check the photo; you can still {goAhead} it.
						</p>
					)}
					{existing && (
						<div className="flex items-start gap-1.5 rounded border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-700">
							<Ban className="mt-0.5 h-3.5 w-3.5 shrink-0" />
							<span>
								{isRequest ? existing.message : newChequeDuplicateText(existing)}{" "}
								<Link to={chequeReportPath(existing.cheque_no)} target="_blank" className="font-medium underline">
									Open cheque {existing.cheque_no}
								</Link>
							</span>
						</div>
					)}
					{isRequest && (
						<p className="text-[11px] text-muted-foreground">
							This payment gets its own new cheque. Once approved, a cheque payment goes straight to
							Reconciliation Pending.
						</p>
					)}
				</>
			)}
		</div>
	);
};
