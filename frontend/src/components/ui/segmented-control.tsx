import * as React from "react";
import { cn } from "@/lib/utils";

type Option = string | { label: React.ReactNode; value: string; disabled?: boolean };

interface SegmentedControlProps {
  options: Option[];
  value?: string;
  onValueChange: (value: string) => void;
  className?: string;
  size?: "sm" | "md";
}

const norm = (o: Option) => (typeof o === "string" ? { label: o, value: o } : o);

/**
 * Segmented button toggle — the Tailwind replacement for antd's
 * `<Radio.Group optionType="button" buttonStyle="solid">`. Connected buttons,
 * active = filled with the app's primary token, theme-aware, keyboard-accessible.
 * `onValueChange` receives the selected value directly (antd's `e.target.value`).
 */
export function SegmentedControl({ options, value, onValueChange, className, size = "md" }: SegmentedControlProps) {
  const opts = options.map(norm);
  return (
    <div role="tablist" className={cn("inline-flex flex-wrap rounded-md border border-input bg-background", className)}>
      {opts.map((o, i) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={o.disabled}
            onClick={() => onValueChange(o.value)}
            className={cn(
              "font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:z-10 disabled:opacity-50 disabled:pointer-events-none",
              size === "sm" ? "px-3 py-1 text-xs" : "px-4 py-1.5 text-sm",
              i > 0 && "border-l border-input",
              i === 0 && "rounded-l-md",
              i === opts.length - 1 && "rounded-r-md",
              active ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-muted"
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
