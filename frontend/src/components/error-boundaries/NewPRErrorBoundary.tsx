import React, { Component, ErrorInfo, ReactNode } from "react";
import * as Sentry from "@sentry/react";
import { captureWorkflowError } from "@/utils/sentry";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AlertCircle, RefreshCw } from "lucide-react";

interface Props {
  children: ReactNode;
  projectId?: string;
  prId?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Error Boundary for New PR Creation/Edit/Resolve workflows
 * Catches React errors and reports them to Sentry with workflow context
 */
export class NewPRErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
    };
  }

  static getDerivedStateFromError(error: Error): State {
    // Update state so the next render will show the fallback UI
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Log error to Sentry with workflow context
    const { projectId, prId } = this.props;

    captureWorkflowError("new-pr", error, {
      project_id: projectId,
      pr_id: prId,
      component_stack: errorInfo.componentStack,
      error_boundary: "NewPRErrorBoundary",
    });

    console.error("NewPRErrorBoundary caught error:", error, errorInfo);
  }

  handleReset = (): void => {
    this.setState({
      hasError: false,
      error: null,
    });
  };

  handleReload = (): void => {
    window.location.reload();
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center min-h-screen p-4 bg-gray-50">
          <div className="max-w-md w-full space-y-4">
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Something went wrong</AlertTitle>
              <AlertDescription>
                An unexpected error occurred while processing your procurement
                request. Our team has been notified and will investigate the
                issue.
              </AlertDescription>
            </Alert>

            {this.state.error && (
              <div className="p-4 bg-white border border-gray-200 rounded-md">
                <p className="text-sm font-medium text-gray-700 mb-2">
                  Error Details:
                </p>
                <p className="text-xs text-gray-600 font-mono break-all">
                  {this.state.error.message}
                </p>
              </div>
            )}

            <div className="flex gap-3">
              <Button
                onClick={this.handleReset}
                variant="outline"
                className="flex-1"
              >
                Try Again
              </Button>
              <Button
                onClick={this.handleReload}
                variant="default"
                className="flex-1"
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                Reload Page
              </Button>
            </div>

            <div className="text-center">
              <Button
                variant="link"
                onClick={() => (window.location.href = "/prs&milestones/procurement-requests")}
                className="text-sm"
              >
                Go back to Procurement Requests
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
