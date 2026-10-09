import type { ElementType } from "react";
import { FileDown, ClipboardList, Receipt, Truck, ClipboardCheck, FileText, ReceiptText, Wallet, BadgeCheck, Banknote } from "lucide-react";
import { BulkDocType } from "./bulkDownloadTypes";

/**
 * How each type looks: the "Choose Type" cards and the progress window's icon tile. Names and
 * descriptions live in TYPE_INFO. A `Record`, so a new type without a style fails the build.
 */
export const TYPE_STYLE: Record<BulkDocType, { icon: ElementType; iconBg: string; iconColor: string }> = {
    PO: { icon: FileDown, iconBg: "bg-blue-50 group-hover:bg-blue-100", iconColor: "text-blue-600" },
    WO: { icon: ClipboardList, iconBg: "bg-green-50 group-hover:bg-green-100", iconColor: "text-green-600" },
    Invoice: { icon: Receipt, iconBg: "bg-purple-50 group-hover:bg-purple-100", iconColor: "text-purple-600" },
    DC: { icon: Truck, iconBg: "bg-orange-50 group-hover:bg-orange-100", iconColor: "text-orange-600" },
    MIR: { icon: ClipboardCheck, iconBg: "bg-teal-50 group-hover:bg-teal-100", iconColor: "text-teal-600" },
    MTC: { icon: BadgeCheck, iconBg: "bg-cyan-50 group-hover:bg-cyan-100", iconColor: "text-cyan-600" },
    DN: { icon: FileText, iconBg: "bg-rose-50 group-hover:bg-rose-100", iconColor: "text-rose-600" },
    ClientInvoice: { icon: ReceiptText, iconBg: "bg-indigo-50 group-hover:bg-indigo-100", iconColor: "text-indigo-600" },
    POPaymentVoucher: { icon: Banknote, iconBg: "bg-lime-50 group-hover:bg-lime-100", iconColor: "text-lime-700" },
    WOPaymentVoucher: { icon: Wallet, iconBg: "bg-amber-50 group-hover:bg-amber-100", iconColor: "text-amber-600" },
};
