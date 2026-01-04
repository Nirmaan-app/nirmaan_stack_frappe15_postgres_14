import { useContext, useState } from "react";
import { useForm } from "react-hook-form";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { FrappeConfig, FrappeContext } from "frappe-react-sdk";
import { ArrowLeft, Loader2, CheckCircle2 } from "lucide-react";

import { UserContext } from "@/utils/auth/UserProvider";
import { toast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { AuthLayout } from "./components/AuthLayout";
import { FormField } from "./components/FormField";

interface ForgotPasswordInputs {
  userId: string;
}

/**
 * Forgot password page with email submission for password reset.
 * Shows success state after email is sent.
 */
export default function ForgotPassword() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [submittedEmail, setSubmittedEmail] = useState("");

  const { currentUser } = useContext(UserContext);
  const { call } = useContext(FrappeContext) as FrappeConfig;
  const navigate = useNavigate();

  const {
    register,
    handleSubmit,
    formState: { errors }
  } = useForm<ForgotPasswordInputs>();

  async function onSubmit(values: ForgotPasswordInputs) {
    try {
      setIsSubmitting(true);

      await call.post("frappe.core.doctype.user.user.reset_password", {
        user: values.userId
      });

      setSubmittedEmail(values.userId);
      setIsSuccess(true);

      toast({
        title: "Email sent",
        description: "Check your inbox for the password reset link.",
        variant: "success"
      });
    } catch (error: any) {
      toast({
        title: "Failed to send reset email",
        description: error?.message || "Please try again later.",
        variant: "destructive"
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  // Redirect if already authenticated
  if (currentUser) {
    return <Navigate to="/" replace />;
  }

  return (
    <AuthLayout isLoading={false}>
      <div className="animate-[slideUp_0.4s_ease-out]">
        {/* Back Link */}
        <Link
          to="/login"
          className={cn(
            "inline-flex items-center gap-2 text-sm text-muted-foreground",
            "hover:text-foreground transition-colors mb-8 group"
          )}
        >
          <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-1" />
          Back to login
        </Link>

        {isSuccess ? (
          /* Success State */
          <div className="text-center">
            <div className="mx-auto w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mb-4">
              <CheckCircle2 className="h-6 w-6 text-green-600" />
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              Check your email
            </h1>
            <p className="text-sm text-muted-foreground mt-2 mb-6">
              We've sent a password reset link to{" "}
              <span className="font-medium text-foreground">{submittedEmail}</span>
            </p>
            <div className="space-y-3">
              <Button
                variant="outline"
                className="w-full h-11 rounded-lg"
                onClick={() => setIsSuccess(false)}
              >
                Try a different email
              </Button>
              <Button
                className="w-full h-11 rounded-lg"
                onClick={() => navigate("/login")}
              >
                Return to login
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-6">
              Didn't receive the email? Check your spam folder or{" "}
              <button
                onClick={() => setIsSuccess(false)}
                className="text-primary hover:underline"
              >
                try again
              </button>
            </p>
          </div>
        ) : (
          /* Form State */
          <>
            {/* Header */}
            <div className="text-center mb-8">
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">
                Forgot password?
              </h1>
              <p className="text-sm text-muted-foreground mt-2">
                Enter your User ID and we'll send you a reset link
              </p>
            </div>

            {/* Reset Form */}
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
              <FormField
                id="userId"
                label="User ID"
                required
                error={errors.userId?.message}
                hint="Enter the email or username associated with your account"
              >
                <Input
                  {...register("userId", {
                    required: "User ID is required"
                  })}
                  id="userId"
                  type="text"
                  placeholder="you@company.com"
                  autoComplete="username"
                  autoFocus
                  disabled={isSubmitting}
                  className={cn(
                    "h-11 rounded-lg transition-all duration-200",
                    "focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:border-primary",
                    "hover:border-muted-foreground/30",
                    errors.userId && "border-destructive focus-visible:ring-destructive/20"
                  )}
                  aria-invalid={!!errors.userId}
                  aria-describedby={errors.userId ? "userId-error" : undefined}
                />
              </FormField>

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
                    Sending...
                  </>
                ) : (
                  "Send reset link"
                )}
              </Button>
            </form>
          </>
        )}
      </div>
    </AuthLayout>
  );
}
