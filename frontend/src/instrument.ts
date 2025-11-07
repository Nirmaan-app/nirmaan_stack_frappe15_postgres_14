import * as Sentry from "@sentry/react";
Sentry.init({
    dsn: "https://4abd03792fe9e411a2af2683a2556528@o4509337331433472.ingest.de.sentry.io/4510142756159568",
    integrations: [
        Sentry.browserTracingIntegration(),
        Sentry.consoleLoggingIntegration({ levels: ["error"] }),
    ],

    // Set tracesSampleRate to 1.0 to capture 100%
    // of transactions for performance monitoring.
    // We recommend adjusting this value in production
    tracesSampleRate: 0.2,
    // Set `tracePropagationTargets` to control for which URLs distributed tracing should be enabled
    tracePropagationTargets: [
        "stack.nirmaan.app",
        /^https:\/\/stack\.nirmaan\.app/,
    ],//["localhost", /^https:\/\/yourserver\.io\/api/],
    sendDefaultPii: true,
    // Enable logs to be sent to Sentry
    enableLogs: true,
});