import { useContext, useState } from "react";
import { useForm } from "react-hook-form";
import { Link, Navigate } from "react-router-dom";
import { FrappeError } from "frappe-react-sdk";
import { Loader2 } from "lucide-react";

import { UserContext } from "@/utils/auth/UserProvider";
import { LoginInputs } from "@/types/Auth/Login";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { AuthLayout } from "./components/AuthLayout";
import { PasswordInput } from "./components/PasswordInput";
import { FormField } from "./components/FormField";

/**
 * Login page component with modern, accessible design.
 * Features proper form semantics, validation, and loading states.
 */
export default function Login() {
  const [error, setError] = useState<FrappeError | null>(null);
  const { currentUser, login, isLoading } = useContext(UserContext);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting }
  } = useForm<LoginInputs>();

  async function onSubmit(values: LoginInputs) {
    setError(null);
    try {
      await login(values.email, values.password);
    } catch (err) {
      setError(err as FrappeError);
    }
  }

  // Redirect if already authenticated
  if (currentUser) {
    return <Navigate to="/" replace />;
  }

  return (
    <AuthLayout isLoading={isLoading}>
      <div className="animate-[slideUp_0.4s_ease-out]">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Welcome back
          </h1>
          <p className="text-sm text-muted-foreground mt-2">
            Enter your credentials to access your account
          </p>
        </div>

        {/* Login Form */}
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
          {/* Email Field */}
          <FormField
            id="email"
            label="Email or Username"
            required
            error={errors.email?.message}
          >
            <Input
              {...register("email", {
                required: "Email or username is required"
              })}
              id="email"
              type="text"
              placeholder="you@company.com"
              autoComplete="username"
              autoFocus
              disabled={isSubmitting}
              className={cn(
                "h-11 rounded-lg transition-all duration-200",
                "focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:border-primary",
                "hover:border-muted-foreground/30",
                errors.email && "border-destructive focus-visible:ring-destructive/20"
              )}
              aria-invalid={!!errors.email}
              aria-describedby={errors.email ? "email-error" : undefined}
            />
          </FormField>

          {/* Password Field */}
          <FormField
            id="password"
            label="Password"
            required
            error={errors.password?.message}
            labelAction={
              <Link
                to="/forgot-password"
                className="text-sm text-primary hover:text-primary/80 transition-colors"
                tabIndex={isSubmitting ? -1 : 0}
              >
                Forgot password?
              </Link>
            }
          >
            <PasswordInput
              {...register("password", {
                required: "Password is required",
                minLength: {
                  value: 6,
                  message: "Password must be at least 6 characters"
                }
              })}
              id="password"
              placeholder="Enter your password"
              autoComplete="current-password"
              disabled={isSubmitting}
              hasError={!!errors.password}
              aria-invalid={!!errors.password}
            />
          </FormField>

          {/* Server Error */}
          {error && (
            <div
              className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 animate-[fadeIn_0.2s_ease-out]"
              role="alert"
            >
              <p className="text-sm text-destructive flex items-center gap-2">
                <svg
                  className="h-4 w-4 flex-shrink-0"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                  aria-hidden="true"
                >
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                    clipRule="evenodd"
                  />
                </svg>
                {error.message || "Login failed. Please check your credentials."}
              </p>
            </div>
          )}

          {/* Submit Button */}
          <Button
            type="submit"
            disabled={isSubmitting}
            className={cn(
              "w-full h-11 rounded-lg font-medium",
              "transition-all duration-200",
              "shadow-sm hover:shadow-md",
              "disabled:opacity-70"
            )}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                Signing in...
              </>
            ) : (
              "Sign in"
            )}
          </Button>
        </form>

        {/* Footer */}
        <div className="mt-8 pt-6 border-t border-border/50">
          <p className="text-center text-xs text-muted-foreground">
            By signing in, you agree to our{" "}
            <a href="#" className="text-primary hover:underline">
              Terms of Service
            </a>{" "}
            and{" "}
            <a href="#" className="text-primary hover:underline">
              Privacy Policy
            </a>
          </p>
        </div>
      </div>
    </AuthLayout>
  );
}
