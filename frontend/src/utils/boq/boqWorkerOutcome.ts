import { isRecord } from "@/utils/backgroundOps/operationFollower";

/** What a BoQ wizard worker returns as its operation's result: the upload parse (`parse_run`) and the template
 *  clone (`create_from_template._clone_worker`) both return `{status: "success", boq_name}` or
 *  `{status: "error", error_code}`. */
export type BoqWorkerOutcome = { ok: true; boqName: string } | { ok: false; errorCode: string | null };

/** PURE. The one reader of that result (F2); anything else reads as an error with no code. */
export function readBoqWorkerOutcome(result: unknown): BoqWorkerOutcome {
  if (isRecord(result) && result.status === "success" && typeof result.boq_name === "string") {
    return { ok: true, boqName: result.boq_name };
  }
  return { ok: false, errorCode: isRecord(result) && typeof result.error_code === "string" ? result.error_code : null };
}
