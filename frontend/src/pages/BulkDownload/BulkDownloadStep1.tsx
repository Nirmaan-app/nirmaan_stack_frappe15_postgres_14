import { FileDown, ClipboardList, ArrowRight, Receipt, Truck, ClipboardCheck, FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { BulkDocType } from "./useBulkDownloadWizard";

interface Step1Props {
    onSelect: (type: BulkDocType) => void;
    /** Item counts for each doc type – shown as badges on the cards */
    counts?: Partial<Record<BulkDocType, number>>;
}

const TYPE_CONFIG: {
    type: BulkDocType;
    label: string;
    description: string;
    icon: React.ElementType;
    iconBg: string;
    iconColor: string;
}[] = [
    {
        type: "PO",
        label: "Procurement Orders",
        description: "Download selected POs with or without rates",
        icon: FileDown,
        iconBg: "bg-blue-50 group-hover:bg-blue-100",
        iconColor: "text-blue-600",
    },
    {
        type: "WO",
        label: "Work Orders",
        description: "Download selected approved WOs / SRs",
        icon: ClipboardList,
        iconBg: "bg-green-50 group-hover:bg-green-100",
        iconColor: "text-green-600",
    },
    {
        type: "Invoice",
        label: "Invoices",
        description: "Download PO invoices, WO invoices, or all",
        icon: Receipt,
        iconBg: "bg-purple-50 group-hover:bg-purple-100",
        iconColor: "text-purple-600",
    },
    {
        type: "DC",
        label: "Delivery Challans",
        description: "Download selected delivery challan attachments",
        icon: Truck,
        iconBg: "bg-orange-50 group-hover:bg-orange-100",
        iconColor: "text-orange-600",
    },
    {
        type: "MIR",
        label: "Material Inspection Reports",
        description: "Download selected MIR attachments",
        icon: ClipboardCheck,
        iconBg: "bg-teal-50 group-hover:bg-teal-100",
        iconColor: "text-teal-600",
    },
    {
        type: "DN",
        label: "Delivery Notes",
        description: "Download delivery note PDFs for selected POs",
        icon: FileText,
        iconBg: "bg-rose-50 group-hover:bg-rose-100",
        iconColor: "text-rose-600",
    },
];

export const BulkDownloadStep1 = ({ onSelect, counts = {} }: Step1Props) => {
    return (
        <div className="flex flex-col items-center gap-8 py-4">
            <div className="text-center space-y-1">
                <h2 className="text-2xl font-bold tracking-tight">What would you like to download?</h2>
                <p className="text-muted-foreground text-sm">
                    Choose a document type. You'll select specific items in the next step.
                </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 w-full">
                {TYPE_CONFIG.map(({ type, label, description, icon: Icon, iconBg, iconColor }) => {
                    const count = counts[type];
                    return (
                        <button
                            key={type}
                            onClick={() => onSelect(type)}
                            className="group relative overflow-hidden rounded-2xl border-2 border-border hover:border-primary bg-card p-5 text-left shadow-sm transition-all duration-200 hover:shadow-md hover:-translate-y-1 focus:outline-none focus:ring-2 focus:ring-primary"
                        >
                            <div className="flex flex-col gap-3">
                                <div className="flex items-center justify-between">
                                    <div className={`p-2.5 rounded-xl ${iconBg} transition-colors`}>
                                        <Icon className={`h-5 w-5 ${iconColor}`} />
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {count != null && (
                                            <Badge variant="secondary" className="text-[11px] font-semibold px-2 py-0.5">
                                                {count}
                                            </Badge>
                                        )}
                                        <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                                    </div>
                                </div>
                                <div>
                                    <p className="font-bold text-base">{label}</p>
                                    <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
                                </div>
                            </div>
                            <div className="absolute inset-0 bg-primary/5 opacity-0 group-hover:opacity-100 transition-opacity rounded-2xl" />
                        </button>
                    );
                })}
            </div>
        </div>
    );
};
