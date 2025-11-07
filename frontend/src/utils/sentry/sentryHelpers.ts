// Sentry Helper Utilities
// Centralized functions for consistent error tracking across workflows

import * as Sentry from "@sentry/react";
import {
  WorkflowType,
  WorkflowErrorContext,
  WorkflowTags,
  BreadcrumbLevel,
} from "./types";

/**
 * Captures an error with workflow-specific context
 *
 * @param workflow - The workflow type (e.g., 'new-pr', 'project-progress-report')
 * @param error - The error object to capture
 * @param context - Additional context data (project_id, item_count, etc.)
 * @param level - Sentry severity level (default: 'error')
 *
 * @example
 * ```typescript
 * captureWorkflowError('new-pr', error, {
 *   project_id: 'PROJECT-123',
 *   mode: 'create',
 *   item_count: 5
 * });
 * ```
 */
export const captureWorkflowError = (
  workflow: WorkflowType,
  error: Error | string,
  context?: WorkflowErrorContext,
  level: Sentry.SeverityLevel = "error"
): void => {
  Sentry.withScope((scope) => {
    // Set the workflow tag
    scope.setTag("workflow", workflow);

    // Set additional context data
    if (context) {
      scope.setContext("workflow_context", context);

      // Set specific tags from context for better filtering
      if (context.project_id) scope.setTag("project_id", context.project_id);
      if (context.mode) scope.setTag("mode", context.mode);
      if (context.report_status) scope.setTag("report_status", context.report_status);
    }

    // Set severity level
    scope.setLevel(level);

    // Capture the error
    if (typeof error === "string") {
      Sentry.captureMessage(error, level);
    } else {
      Sentry.captureException(error);
    }

    console.log(`[Sentry] Error captured for workflow: ${workflow}`, {
      error,
      context,
    });
  });
};

/**
 * Starts a performance span for a workflow using Sentry v8 API
 * Returns a function that must be called to end the span
 *
 * @param workflow - The workflow type
 * @param operation - Description of the operation (e.g., 'submit-pr', 'save-draft')
 * @param data - Additional data to attach to the span
 * @returns Function to end the span (call when operation completes)
 *
 * @example
 * ```typescript
 * const endSpan = startWorkflowTransaction('new-pr', 'submit-pr', {
 *   project_id: 'PROJECT-123',
 *   item_count: 5
 * });
 *
 * try {
 *   // Your workflow logic
 *   await submitPR();
 * } catch (error) {
 *   // Error status is set automatically
 *   throw error;
 * } finally {
 *   endSpan(); // Must call to finish the span
 * }
 * ```
 */
export const startWorkflowTransaction = (
  workflow: WorkflowType,
  operation: string,
  data?: WorkflowErrorContext
): (() => void) => {
  let spanEnded = false;

  // Start a span manually so we can control when it ends
  const span = Sentry.startSpanManual(
    {
      name: `${workflow}:${operation}`,
      op: operation,
      attributes: {
        workflow,
        ...(data || {}),
      },
    },
    (span) => {
      console.log(
        `[Sentry] Span started: ${workflow}:${operation}`,
        data
      );

      // Return a cleanup function
      return () => {
        if (!spanEnded) {
          span.end();
          spanEnded = true;
          console.log(`[Sentry] Span ended: ${workflow}:${operation}`);
        }
      };
    }
  );

  // Return the cleanup function
  return span || (() => {});
};

/**
 * Adds a breadcrumb to track user actions in a workflow
 *
 * @param workflow - The workflow type
 * @param message - Breadcrumb message (e.g., 'Work package selected')
 * @param data - Additional data to attach to breadcrumb
 * @param level - Breadcrumb level (default: 'info')
 *
 * @example
 * ```typescript
 * addWorkflowBreadcrumb('new-pr', 'Work package selected', {
 *   work_package: 'Civil',
 *   category_count: 3
 * });
 *
 * addWorkflowBreadcrumb('project-progress-report', 'Photo uploaded', {
 *   photo_count: 5,
 *   tab: 'Photos'
 * }, 'info');
 * ```
 */
export const addWorkflowBreadcrumb = (
  workflow: WorkflowType,
  message: string,
  data?: WorkflowErrorContext,
  level: BreadcrumbLevel = "info"
): void => {
  Sentry.addBreadcrumb({
    category: workflow,
    message,
    level,
    data: {
      workflow,
      ...data,
    },
    timestamp: Date.now() / 1000,
  });

  console.log(`[Sentry] Breadcrumb: [${workflow}] ${message}`, data);
};

/**
 * Sets custom tags for a workflow scope
 *
 * @param tags - Object of key-value pairs to set as tags
 *
 * @example
 * ```typescript
 * setWorkflowTags({
 *   workflow: 'new-pr',
 *   project_id: 'PROJECT-123',
 *   mode: 'create',
 *   has_attachments: 'true'
 * });
 * ```
 */
export const setWorkflowTags = (tags: WorkflowTags): void => {
  Object.entries(tags).forEach(([key, value]) => {
    Sentry.setTag(key, value);
  });

  console.log("[Sentry] Tags set:", tags);
};

/**
 * Helper function to detect if an error is a network error
 *
 * @param error - The error object to check
 * @returns True if the error is network-related
 */
export const isNetworkError = (error: any): boolean => {
  if (!error) return false;

  const errorMessage = error.message?.toLowerCase() || "";
  const errorString = error.toString().toLowerCase();

  return (
    errorMessage.includes("network") ||
    errorMessage.includes("fetch") ||
    errorMessage.includes("timeout") ||
    errorString.includes("networkerror") ||
    error.name === "NetworkError" ||
    error.code === "ECONNABORTED" ||
    error.code === "ERR_NETWORK"
  );
};

/**
 * Helper function to detect if an error is a timeout error
 *
 * @param error - The error object to check
 * @returns True if the error is timeout-related
 */
export const isTimeoutError = (error: any): boolean => {
  if (!error) return false;

  const errorMessage = error.message?.toLowerCase() || "";
  const errorString = error.toString().toLowerCase();

  return (
    errorMessage.includes("timeout") ||
    errorString.includes("timeout") ||
    error.code === "ETIMEDOUT" ||
    error.code === "ECONNABORTED"
  );
};

/**
 * Helper function to detect if an error is a server error (5xx)
 *
 * @param error - The error object to check
 * @returns True if the error is a server error
 */
export const isServerError = (error: any): boolean => {
  if (!error) return false;

  // Check for HTTP status codes
  if (error.status && error.status >= 500 && error.status < 600) {
    return true;
  }

  // Check for response status
  if (error.response?.status >= 500 && error.response?.status < 600) {
    return true;
  }

  return false;
};

/**
 * Captures a network-related error with appropriate tagging
 *
 * @param workflow - The workflow type
 * @param error - The error object
 * @param context - Additional context
 */
export const captureNetworkError = (
  workflow: WorkflowType,
  error: Error,
  context?: WorkflowErrorContext
): void => {
  const enhancedContext = {
    ...context,
    error_type: "network",
    is_timeout: isTimeoutError(error),
    is_server_error: isServerError(error),
  };

  captureWorkflowError(workflow, error, enhancedContext, "error");
};

/**
 * Wraps an async function with automatic error capturing using Sentry v8 API
 *
 * @param workflow - The workflow type
 * @param operation - Operation name
 * @param fn - The async function to wrap
 * @param context - Additional context
 * @returns Wrapped function
 *
 * @example
 * ```typescript
 * const wrappedSubmit = wrapWithErrorCapture(
 *   'new-pr',
 *   'submit-pr',
 *   async () => {
 *     await submitPR();
 *   },
 *   { project_id: 'PROJECT-123' }
 * );
 *
 * await wrappedSubmit();
 * ```
 */
export const wrapWithErrorCapture = <T>(
  workflow: WorkflowType,
  operation: string,
  fn: () => Promise<T>,
  context?: WorkflowErrorContext
): (() => Promise<T>) => {
  return async () => {
    const endSpan = startWorkflowTransaction(workflow, operation, context);

    try {
      const result = await fn();
      return result;
    } catch (error: any) {
      // Span status is automatically set to error when exception is thrown
      // Capture with appropriate error type
      if (isNetworkError(error)) {
        captureNetworkError(workflow, error, context);
      } else {
        captureWorkflowError(workflow, error, context);
      }

      throw error;
    } finally {
      endSpan();
    }
  };
};
