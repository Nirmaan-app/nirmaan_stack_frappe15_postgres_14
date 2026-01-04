import * as React from "react";
import { useState, forwardRef } from "react";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export interface PasswordInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  /** Error state for visual feedback */
  hasError?: boolean;
}

/**
 * Password input with show/hide toggle button.
 * Provides accessible password visibility control with proper ARIA attributes.
 */
const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  ({ className, hasError, id, ...props }, ref) => {
    const [showPassword, setShowPassword] = useState(false);
    const toggleId = id ? `${id}-toggle` : undefined;

    return (
      <div className="relative">
        <input
          type={showPassword ? "text" : "password"}
          id={id}
          className={cn(
            "flex h-11 w-full rounded-lg border bg-transparent px-4 py-2 pr-12",
            "text-sm shadow-sm transition-all duration-200",
            "placeholder:text-muted-foreground/60",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:border-primary",
            "disabled:cursor-not-allowed disabled:opacity-50",
            hasError
              ? "border-destructive focus-visible:ring-destructive/20 focus-visible:border-destructive"
              : "border-input hover:border-muted-foreground/30",
            className
          )}
          ref={ref}
          aria-describedby={hasError ? `${id}-error` : undefined}
          {...props}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          id={toggleId}
          className={cn(
            "absolute right-1 top-1/2 -translate-y-1/2 h-9 w-9",
            "text-muted-foreground hover:text-foreground",
            "hover:bg-transparent focus-visible:bg-transparent",
            "transition-colors duration-200"
          )}
          onClick={() => setShowPassword(!showPassword)}
          aria-label={showPassword ? "Hide password" : "Show password"}
          aria-pressed={showPassword}
          tabIndex={-1}
        >
          {showPassword ? (
            <EyeOff className="h-4 w-4" aria-hidden="true" />
          ) : (
            <Eye className="h-4 w-4" aria-hidden="true" />
          )}
        </Button>
      </div>
    );
  }
);

PasswordInput.displayName = "PasswordInput";

export { PasswordInput };
