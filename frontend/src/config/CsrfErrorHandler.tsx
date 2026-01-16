/**
 * CSRF Error Handler Component
 *
 * Provides global error handling for CSRF token validation failures.
 * When a 403 CSRF error is detected, it attempts to refresh the token
 * and prompts the user to retry. If refresh fails, redirects to login.
 */
import { useFrappeAuth } from "frappe-react-sdk";
import { useEffect, useCallback } from "react";
import { toast } from "@/components/ui/use-toast";
import {
  refreshCsrfToken,
  isCsrfError,
  is403Error,
} from "@/utils/csrfTokenRefresh";

interface CsrfErrorHandlerProps {
  children: React.ReactNode;
}

export const CsrfErrorHandler: React.FC<CsrfErrorHandlerProps> = ({
  children,
}) => {
  const { logout } = useFrappeAuth();

  const handleCsrfError = useCallback(async () => {
    console.warn("CSRF token expired, attempting refresh...");

    const newToken = await refreshCsrfToken();

    if (newToken) {
      toast({
        title: "Session Refreshed",
        description: "Please retry your action.",
        variant: "default",
      });
    } else {
      // Token refresh failed - session likely expired completely
      console.error("Failed to refresh CSRF token, session may have expired");
      toast({
        title: "Session Expired",
        description: "Please log in again to continue.",
        variant: "destructive",
      });

      // Give user time to see the message before redirect
      setTimeout(() => {
        logout();
      }, 1500);
    }
  }, [logout]);

  useEffect(() => {
    // Global handler for unhandled promise rejections (catches CSRF errors from frappe-react-sdk)
    const handleUnhandledRejection = async (
      event: PromiseRejectionEvent
    ): Promise<void> => {
      const error = event.reason;

      // Check if it's a 403 CSRF error
      if (is403Error(error) && isCsrfError(error)) {
        event.preventDefault(); // Prevent default error logging to console
        await handleCsrfError();
      }
    };

    // Also handle errors that might come through error events
    const handleError = (event: ErrorEvent): void => {
      const error = event.error;
      if (is403Error(error) && isCsrfError(error)) {
        event.preventDefault();
        handleCsrfError();
      }
    };

    window.addEventListener("unhandledrejection", handleUnhandledRejection);
    window.addEventListener("error", handleError);

    return () => {
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
      window.removeEventListener("error", handleError);
    };
  }, [handleCsrfError]);

  return <>{children}</>;
};

export default CsrfErrorHandler;
