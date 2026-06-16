// Tracks every Frappe File doc created during the active wizard session and
// best-effort cleans up orphans on Cancel / unload / unmount.
//
// Belt-and-braces: a server-side daily janitor (cleanup_orphan_commission_attachments)
// catches anything missed here. So this hook is allowed to be best-effort.

import { useCallback, useEffect, useRef } from 'react';

interface UseReportAttachmentsParams {
    parent: string;
    childRowName: string;
    /** Whether the wizard has successfully submitted. When true, no cleanup runs on unmount. */
    isCommitted: boolean;
    /** File docnames referenced by the FINAL committed response_data.
     *  Anything not in here at unmount time is considered orphan. */
    keepNamesRef: React.MutableRefObject<string[]>;
}

export interface UseReportAttachmentsResult {
    /** Add a new File docname to the session-tracked set. */
    track: (fileDocName: string) => void;
    /** Manually fire orphan-cleanup (e.g. on explicit Cancel button). */
    cleanupOrphans: () => Promise<void>;
}

const ENDPOINT =
    '/api/method/nirmaan_stack.api.commission_report.delete_orphan_attachments.delete_orphan_attachments';

export const useReportAttachments = ({
    parent,
    childRowName,
    isCommitted,
    keepNamesRef,
}: UseReportAttachmentsParams): UseReportAttachmentsResult => {
    const sessionFilesRef = useRef<Set<string>>(new Set());
    const isCommittedRef = useRef(isCommitted);
    isCommittedRef.current = isCommitted;

    const track = useCallback((fileDocName: string) => {
        if (fileDocName) sessionFilesRef.current.add(fileDocName);
    }, []);

    const cleanupOrphans = useCallback(async () => {
        if (!parent || !childRowName) return;
        const session = Array.from(sessionFilesRef.current);
        const keep = new Set(keepNamesRef.current || []);
        const toDelete = session.filter((n) => !keep.has(n));
        if (!toDelete.length) return;
        try {
            await fetch(ENDPOINT, {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Frappe-CSRF-Token':
                        (window as unknown as { csrf_token?: string }).csrf_token || 'token',
                },
                body: JSON.stringify({
                    parent,
                    task_row_name: childRowName,
                    keep_file_doc_names: Array.from(keep),
                }),
            });
        } catch {
            /* best-effort */
        }
    }, [childRowName, keepNamesRef, parent]);

    // Cleanup on unmount (Cancel button, route change).
    useEffect(() => {
        return () => {
            if (isCommittedRef.current) return;
            void cleanupOrphans();
        };
    }, [cleanupOrphans]);

    // Cleanup on browser unload (close tab / navigate away).
    useEffect(() => {
        const handler = () => {
            if (isCommittedRef.current) return;
            const session = Array.from(sessionFilesRef.current);
            const keep = new Set(keepNamesRef.current || []);
            const orphans = session.filter((n) => !keep.has(n));
            if (!orphans.length) return;
            const data = JSON.stringify({
                parent,
                task_row_name: childRowName,
                keep_file_doc_names: Array.from(keep),
            });
            try {
                navigator.sendBeacon(ENDPOINT, new Blob([data], { type: 'application/json' }));
            } catch {
                /* best-effort */
            }
        };
        window.addEventListener('beforeunload', handler);
        return () => window.removeEventListener('beforeunload', handler);
    }, [childRowName, keepNamesRef, parent]);

    return { track, cleanupOrphans };
};
