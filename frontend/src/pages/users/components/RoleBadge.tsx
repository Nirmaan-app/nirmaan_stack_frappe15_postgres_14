import { cn } from "@/lib/utils";
import { getRoleColors, getRoleLabel } from "@/utils/roleColors";

interface RoleBadgeProps {
  roleProfile: string | undefined | null;
  showDot?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
}

/**
 * Color-coded badge for user roles
 * Displays role with consistent colors across the application
 */
export function RoleBadge({
  roleProfile,
  showDot = true,
  size = "md",
  className
}: RoleBadgeProps) {
  const colors = getRoleColors(roleProfile);
  const label = getRoleLabel(roleProfile);

  const sizeClasses = {
    sm: "px-2 py-0.5 text-xs",
    md: "px-2.5 py-0.5 text-xs",
    lg: "px-3 py-1 text-sm",
  };

  const dotSizes = {
    sm: "w-1.5 h-1.5",
    md: "w-2 h-2",
    lg: "w-2.5 h-2.5",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border font-medium transition-colors",
        colors.bg,
        colors.text,
        colors.border,
        sizeClasses[size],
        className
      )}
    >
      {showDot && (
        <span
          className={cn(
            "rounded-full flex-shrink-0",
            colors.dot,
            dotSizes[size]
          )}
        />
      )}
      {label}
    </span>
  );
}

/**
 * Compact role indicator - just the colored dot with tooltip
 * Use for space-constrained UIs like table cells
 */
export function RoleDot({
  roleProfile,
  size = "md",
  className
}: Omit<RoleBadgeProps, 'showDot'>) {
  const colors = getRoleColors(roleProfile);
  const label = getRoleLabel(roleProfile);

  const dotSizes = {
    sm: "w-2 h-2",
    md: "w-2.5 h-2.5",
    lg: "w-3 h-3",
  };

  return (
    <span
      title={label}
      className={cn(
        "inline-block rounded-full cursor-help",
        colors.dot,
        dotSizes[size],
        className
      )}
    />
  );
}
