// Handover PDFs built on the server's `long` queue (`api/hod/binder.py`): the whole BINDER of a system, or the
// CONTENT of one document (the actual Commission reports / TDS sheets / snag list, not the list page).
// Same shape as the Commission Report bulk download: enqueue -> socket progress carrying our job_id -> a
// one-time token downloaded through fetch_temp_file.
//
// A build always SAVES its PDF. Showing it in the preview dialog instead was tried on 2026-09-25 and
// REVERTED the same day: `enqueue_binder` refuses a document that is not answered YES (`build_plan`), and
// Preview is exactly what you want BEFORE answering, so it threw on every unanswered row.

import {
  FrappeConfig,
  FrappeContext,
  useFrappePostCall,
} from "frappe-react-sdk";
import { useCallback, useContext, useEffect, useRef, useState } from "react";

import { toast } from "@/components/ui/use-toast";
import {
  readBinderResume,
  writeBinderResume,
} from "@/utils/hodBinderResume";
import { getFrappeError } from "@/utils/frappeErrors";

import { HOD_METHODS } from "./hodApi";
import { saveUrlAs } from "./hodDownloads";

const EV_PROGRESS = "hod_binder_progress";
const EV_READY = "hod_binder_ready";
const EV_FAILED = "hod_binder_failed";
/** No event at all for this long means the job is stuck; every progress tick re-arms it. */
const STALL_TIMEOUT_MS = 5 * 60 * 1000;
/** Realtime events do not reliably reach the browser on every setup, so the job status is polled too. */
const POLL_MS = 2000;

export interface BinderProgress {
  done: number;
  total: number;
  label?: string;
}

/** What is being built: the binder of `hodSystem`, or one document's content. */
export interface HodJob {
  hodSystem: string;
  document: string | null;
  title: string;
}

type JobEvent = { job_id?: string } & Record<string, any>;

export function useHodBinder() {
  const { socket } = useContext(FrappeContext) as FrappeConfig;
  const enqueue = useFrappePostCall<{ message: { job_id: string } }>(
    HOD_METHODS.enqueueBinder,
  );
  const statusCall = useFrappePostCall<{
    message: JobEvent & { state: string };
  }>(HOD_METHODS.jobStatus);
  const [job, setJob] = useState<HodJob | null>(null);
  const [progress, setProgress] = useState<BinderProgress | null>(null);
  const jobIdRef = useRef<string | null>(null);
  // Events that arrive before the enqueue call has told us our job_id (a one-file job can finish first).
  const earlyRef = useRef<Array<[string, JobEvent]>>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // A job can end over BOTH the socket and the poll: download / announce it once.
  const finishedRef = useRef<Set<string>>(new Set());

  const reset = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    jobIdRef.current = null;
    earlyRef.current = [];
    writeBinderResume(null);
    setJob(null);
    setProgress(null);
  }, []);

  const arm = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      toast({
        title: "Download is taking too long",
        description: "No progress for several minutes. Please try again.",
        variant: "destructive",
      });
      reset();
    }, STALL_TIMEOUT_MS);
  }, [reset]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  // Pick up a build that was still running when this screen last unmounted (see
  // `utils/hodBinderResume`). Setting `job` is what restarts the poll below, and the
  // poll is what delivers the PDF.
  useEffect(() => {
    const resumed = readBinderResume();
    if (!resumed) return;
    jobIdRef.current = resumed.jobId;
    setJob({
      hodSystem: resumed.hodSystem,
      document: resumed.document,
      title: resumed.title,
    });
    arm();
    // Mount only: a resume point is read once, never re-read while this screen is up.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handle = useCallback(
    (event: string, d: JobEvent) => {
      if (event !== EV_PROGRESS) {
        if (!d.job_id || finishedRef.current.has(d.job_id)) return;
        finishedRef.current.add(d.job_id);
      }
      if (event === EV_PROGRESS) {
        setProgress({ done: d.done, total: d.total, label: d.label });
        arm();
      } else if (event === EV_READY) {
        saveUrlAs(
          `/api/method/nirmaan_stack.api.pdf_helper.bulk_download.fetch_temp_file?token=${d.token}&filename=${encodeURIComponent(d.filename)}`,
          d.filename,
        );
        const failed: string[] = d.failed ?? [];
        toast(
          failed.length
            ? {
                title: "Downloaded with gaps",
                description: `Could not include: ${failed.slice(0, 4).join(", ")}${failed.length > 4 ? ` and ${failed.length - 4} more` : ""}.`,
                variant: "destructive",
              }
            : {
                title: "Ready",
                description: "Your PDF is downloading.",
                variant: "success",
              },
        );
        reset();
      } else if (event === EV_FAILED) {
        toast({
          title: "Download failed",
          description: d.message || "The PDF could not be built.",
          variant: "destructive",
        });
        reset();
      }
    },
    [arm, reset],
  );

  useEffect(() => {
    if (!socket) return;
    const on = (event: string) => (d: JobEvent) => {
      if (!d?.job_id) return;
      if (jobIdRef.current === null) {
        earlyRef.current.push([event, d]); // our job_id is not known yet
        return;
      }
      if (d.job_id === jobIdRef.current) handle(event, d);
    };
    const handlers = [EV_PROGRESS, EV_READY, EV_FAILED].map(
      (e) => [e, on(e)] as const,
    );
    handlers.forEach(([e, h]) => socket.on(e, h));
    return () => handlers.forEach(([e, h]) => socket.off(e, h));
  }, [socket, handle]);

  // Poll the job's status while one runs (the socket is only the fast path).
  const running = job !== null;
  useEffect(() => {
    if (!running) return;
    const id = setInterval(async () => {
      const jobId = jobIdRef.current;
      if (!jobId) return;
      try {
        const st = (await statusCall.call({ job_id: jobId })).message;
        if (jobIdRef.current !== jobId) return;
        if (st.state === "running") handle(EV_PROGRESS, st);
        else if (st.state === "ready") handle(EV_READY, st);
        else if (st.state === "failed") handle(EV_FAILED, st);
      } catch {
        // a missed poll is fine; the next one (or the socket) catches up
      }
    }, POLL_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, handle]);

  /** Switched-on documents with nothing to include (the binder refuses to start while there are any). */

  /** Build the binder of `hodSystem`, or — with `document` — that document's content. */
  const build = useCallback(
    async (
      project: string,
      hodSystem: string,
      title: string,
      document: string | null = null,
    ) => {
      if (job) return;
      setJob({ hodSystem, document, title });
      setProgress(null);
      earlyRef.current = [];
      try {
        const res = await enqueue.call({
          project,
          hod_system: hodSystem,
          ...(document ? { document } : {}),
        });
        const jobId = res.message.job_id;
        jobIdRef.current = jobId;
        writeBinderResume({ jobId, hodSystem, document, title, startedAt: Date.now() });
        arm();
        const early = earlyRef.current.filter(([, d]) => d.job_id === jobId);
        earlyRef.current = [];
        early.forEach(([event, d]) => handle(event, d));
      } catch (error) {
        toast({
          title: "Could not start the download",
          description: getFrappeError(error),
          variant: "destructive",
        });
        reset();
      }
    },
    [job, enqueue, arm, handle, reset],
  );

  return { build, job, progress };
}
