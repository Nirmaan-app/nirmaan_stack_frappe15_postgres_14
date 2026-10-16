import { Badge } from "@/components/ui/badge";
import { BulkDocType } from "./useBulkDownloadWizard";
import { TYPE_INFO } from "@/utils/bulkDownload/bulkDownloadTypes";
import { TYPE_STYLE } from "@/utils/bulkDownload/bulkDownloadStyle";

interface Step1Props {
    onSelect: (type: BulkDocType) => void;
    /** The cards to show (`allowedBulkTypes` for the scope and role). */
    types: BulkDocType[];
    /** Item counts for each doc type – shown as badges on the cards */
    counts?: Partial<Record<BulkDocType, number>>;
}

export const BulkDownloadStep1 = ({ onSelect, types, counts = {} }: Step1Props) => {

    return (
        <div className="flex flex-col items-center gap-8 py-4">

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 w-full">
                {types.map((type) => {
                    const { card: label, description } = TYPE_INFO[type];
                    const { icon: Icon, iconBg, iconColor } = TYPE_STYLE[type];
                    const count = counts[type];
                    return (
                        <button
                            key={type}
                            onClick={() => onSelect(type)}
                            className="group relative overflow-hidden rounded-lg border-2 border-border hover:border-primary bg-card p-5 text-left shadow-sm transition-all duration-200 hover:shadow-md hover:-translate-y-1 focus:outline-none focus:ring-2 focus:ring-primary"
                        >
                            <div className="flex flex-col gap-3">
                                <div className="flex items-center justify-between">
                                    <div className={`p-2.5 rounded-md ${iconBg} transition-colors`}>
                                        <Icon className={`h-5 w-5 ${iconColor}`} />
                                    </div>
                                    {count != null && (
                                        <Badge variant="secondary" className="text-[11px] font-semibold px-2 py-0.5">
                                            {count}
                                        </Badge>
                                    )}
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
