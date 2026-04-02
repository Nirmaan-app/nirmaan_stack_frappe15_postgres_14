import { ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";

interface VendorHoldBannerProps {
  className?: string;
  compact?: boolean;  // For inline usage in cards/tables
  vendorName?: string;
  availableCredit?: number;
}

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(amount);

export function VendorHoldBanner({ className, compact = false, vendorName, availableCredit }: VendorHoldBannerProps) {
  if (compact) {
    return (
      <div className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full",
        "bg-amber-100 text-amber-800 text-xs font-medium",
        "border border-amber-300",
        className
      )}>
        <ShieldAlert className="h-3 w-3" />
        <span>On-Hold</span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-lg",
        "bg-gradient-to-r from-amber-50 to-orange-50",
        "border-l-4 border-amber-600",
        "shadow-sm",
        className
      )}
      role="alert"
      aria-live="polite"
    >
      {/* Subtle background pattern */}
      <div className="absolute inset-0 opacity-[0.03]">
        <div className="absolute inset-0" style={{
          backgroundImage: `repeating-linear-gradient(
            45deg,
            currentColor 0,
            currentColor 1px,
            transparent 0,
            transparent 50%
          )`,
          backgroundSize: '10px 10px'
        }} />
      </div>

      <div className="relative flex items-start gap-4 p-4">
        {/* Icon with subtle pulse */}
        <div className="flex-shrink-0 mt-0.5">
          <div className="relative">
            <ShieldAlert className="h-5 w-5 text-amber-600" />
            <div className="absolute inset-0 animate-ping opacity-20">
              <ShieldAlert className="h-5 w-5 text-amber-600" />
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-amber-900 tracking-tight">
            Vendor On Hold — Credit Limit Exceeded
          </h3>
          <p className="mt-1 text-sm text-amber-700 leading-relaxed">
            Dispatch and pre-dispatch payment operations are restricted.
            {vendorName && (
              <span className="block mt-1 text-amber-600 font-medium">
                {vendorName}{availableCredit !== undefined ? ` · Available credit: ${formatCurrency(availableCredit)}` : ""}
                {" · "}Contact Admin/PMO to adjust credit limit.
              </span>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
