/**
 * A row of pills that picks one sub-view of a tab (Vendor Invoice Recon's Pending Approval and All Invoices). Scrolls
 * sideways on a phone, wraps on a wider screen. `useUrlPill` keeps the choice in the URL.
 */
import { cn } from "@/lib/utils";

interface PillBarProps<K extends string> {
    pills: readonly { key: K; label: string }[];
    value: K;
    onChange: (key: K) => void;
}

/** The pills as toggle buttons; the one whose key is `value` is pressed. */
export const PillBar = <K extends string>({ pills, value, onChange }: PillBarProps<K>) => (
    <div className="overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0 scrollbar-thin">
        <div className="flex gap-1.5 sm:flex-wrap pb-1 sm:pb-0">
            {pills.map((pill) => (
                <button
                    key={pill.key}
                    type="button"
                    aria-pressed={pill.key === value}
                    onClick={() => onChange(pill.key)}
                    className={cn(
                        "px-2.5 sm:px-3 py-1 sm:py-1.5 text-xs sm:text-sm rounded transition-colors flex items-center gap-1.5 whitespace-nowrap",
                        pill.key === value ? "bg-sky-500 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200",
                    )}
                >
                    {pill.label}
                </button>
            ))}
        </div>
    </div>
);
