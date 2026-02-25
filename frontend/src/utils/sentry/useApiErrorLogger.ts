import { useEffect, useRef } from "react";
import { captureApiError } from "@/utils/sentry/captureApiError";
import { useFrappeAuth } from "frappe-react-sdk";

export interface LoggerOptions {
    hook: string;
    api: string;
    feature: string;
    doctype?: string;
    entity_id?: string;
}

export const useApiErrorLogger = (error: any, options: LoggerOptions) => {
    const lastErrorIdRef = useRef<string | null>(null);
    const { currentUser } = useFrappeAuth();

    useEffect(() => {
        if (!error) return;
        const currentErrorId = [
            options.feature,
            options.hook,
            options.api,
            options.doctype ?? "",
            options.entity_id ?? "",
            error?.message ?? "",
            error?.httpStatus ?? "",
        ].join("|");

        if (lastErrorIdRef.current === currentErrorId) return;
        lastErrorIdRef.current = currentErrorId;

        captureApiError({
            hook: options.hook,
            api: options.api,
            feature: options.feature,
            doctype: options.doctype,
            entity_id: options.entity_id,
            error: error,
            user: currentUser ?? undefined,
        });
    }, [
        error,
        options.hook,
        options.api,
        options.feature,
        options.doctype,
        options.entity_id,
        currentUser,
    ]);
};
