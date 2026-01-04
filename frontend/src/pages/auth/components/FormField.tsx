import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface FormFieldProps {
  /** Unique identifier for the field */
  id: string;
  /** Field label text */
  label: string;
  /** Whether the field is required */
  required?: boolean;
  /** Error message to display */
  error?: string;
  /** Optional hint text */
  hint?: string;
  /** Additional content to render in the label row (e.g., forgot password link) */
  labelAction?: ReactNode;
  /** The form input element */
  children: ReactNode;
  /** Additional CSS classes for the wrapper */
  className?: string;
}

/**
 * Consistent form field wrapper with label, input, and error message.
 * Provides proper accessibility attributes and visual hierarchy.
 */
export function FormField({
  id,
  label,
  required = false,
  error,
  hint,
  labelAction,
  children,
  className
}: FormFieldProps) {
  return (
    <div className={cn("space-y-2", className)}>
      {/* Label Row */}
      <div className="flex items-center justify-between">
        <label
          htmlFor={id}
          className="text-sm font-medium leading-none text-foreground"
        >
          {label}
          {required && (
            <span className="text-destructive ml-1" aria-hidden="true">
              *
            </span>
          )}
        </label>
        {labelAction}
      </div>

      {/* Input */}
      {children}

      {/* Error Message */}
      {error && (
        <p
          id={`${id}-error`}
          className="text-sm text-destructive flex items-center gap-1.5 animate-[fadeIn_0.2s_ease-out]"
          role="alert"
        >
          <svg
            className="h-3.5 w-3.5 flex-shrink-0"
            fill="currentColor"
            viewBox="0 0 20 20"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
              clipRule="evenodd"
            />
          </svg>
          {error}
        </p>
      )}

      {/* Hint Text */}
      {hint && !error && (
        <p className="text-xs text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}

export default FormField;
