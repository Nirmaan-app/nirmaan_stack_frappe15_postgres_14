import { Info } from "lucide-react";
import { tdsRateHint } from "../utils/vendorTaxIds";

interface VendorTdsRateHintProps {
    /** The PAN as typed in the form. */
    pan: string | null | undefined;
}

/**
 * The line under the TDS field on the new-vendor and edit-vendor forms. An Individual / HUF PAN fixes
 * the rate at 1%, so that case is a yellow notice the user cannot miss (`tdsRateHint`).
 */
export const VendorTdsRateHint: React.FC<VendorTdsRateHintProps> = ({ pan }) => {
    const hint = tdsRateHint(pan);

    if (hint.tone === "fixed-1") {
        return (
            <div className="flex items-start gap-1.5 rounded-md border border-yellow-200 bg-yellow-50 px-2 py-1.5 text-xs text-yellow-800">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{hint.text}</span>
            </div>
        );
    }

    return <p className="text-xs text-muted-foreground">Applied to this vendor's payments. {hint.text}</p>;
};
