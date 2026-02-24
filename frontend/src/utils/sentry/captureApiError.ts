import * as Sentry from "@sentry/react";

interface ApiErrorContext {
  hook: string;
  api: string;
  feature?: string;
  doctype?: string;
  entity_id?: string;
  error: any;
}

export const captureApiError = ({
  hook,
  api,
  feature = "general",
  doctype,
  entity_id,
  error,
}: ApiErrorContext) => {

  const httpStatus = error?.httpStatus;

  const wrappedError = new Error(
    `[API FAILURE] ${feature} → ${hook} → ${api} (${httpStatus ?? "unknown"})`
  );

  Sentry.withScope((scope) => {

    // 🔹 Force separate issue per hook
    scope.setFingerprint([
      feature,
      hook,
      api,
      String(httpStatus || "unknown"),
    ]);

    // 🔹 Searchable tags
    scope.setTag("layer", "api");
    scope.setTag("feature", feature);
    scope.setTag("hook", hook);
    scope.setTag("api", api);
    scope.setTag("httpStatus", httpStatus || "unknown");

    if (doctype) scope.setTag("doctype", doctype);

    // 🔹 Full backend info
    scope.setContext("api_details", {
      hook,
      api,
      doctype,
      entity_id,
      httpStatus,
      httpStatusText: error?.httpStatusText,
      backendMessage: error?._server_messages,
      original_error: error,
    });

    // 🔹 Attach original error for debugging
    scope.setExtra("original_error", error);

    Sentry.captureException(wrappedError);
  });
};
