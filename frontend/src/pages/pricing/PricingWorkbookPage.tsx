// Generic pricing workbook page (PM-2 -> PW-1 -> PW-2a). ONE module serves every
// entry in the PRICING_WORKBOOKS registry (HVAC / Electrical / ELV); each has its
// own route object, and the page resolves WHICH workbook it is from its own route
// path. Lazy route module -- exports `Component` per the M1.59 lazy() contract.
// Mounts the vendored Luckysheet engine (script-injected, not bundled), reads/writes
// the workbook through the PM-1 whitelisted API, and enforces a single-editor
// checkout lock. Access is gated by <PricingRoute />; the backend API is the real
// enforcement layer.
//
// PW-1 replaced two single-workbook assumptions: selection was `rows[0]` of an
// unfiltered list (a MOVING target -- list_workbooks orders by `modified desc`),
// and the empty state fired on "zero workbooks in the SYSTEM", which made import
// unreachable for every page once any one workbook existed. Both are now keyed on
// the registry entry's `title`, so each page has an independent
// empty -> import -> ready lifecycle.
//
// PW-2a adds three things on top, all keyed off ONE derived flag (isPricingAdmin):
//   * ROLE SPLIT -- admins keep Edit/Save/Release/Import/Replace; estimation users
//     get read + Sandbox only. The backend write gate
//     (_require_pricing_write_access) is the enforcement boundary; everything here
//     is UX.
//   * SANDBOX -- a local, never-persisted edit session that takes NO lock, for
//     both roles. See handleEnterSandbox.
//   * REPLACE FROM EXCEL -- re-import over an EXISTING workbook via save_workbook
//     (not create: `title` is unique), so the previous content survives as version
//     history.
// ...plus a warn-only save-time formula advisory (pricingFormulaScan).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useFrappePostCall } from "frappe-react-sdk";
import { Maximize2, Minimize2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useUserData } from "@/hooks/useUserData";
import {
	buildWorkbookForm,
	decodeSheetNames,
	loadPricingLibs,
	normalizeFormulas,
	reenterNormalizedFormulas,
	serializeSheets,
	watermarkBackground,
} from "./pricingLibs";
import {
	scanWorkbookFormulas,
	supportedFunctionsFromEngine,
	type FormulaScanHit,
} from "./pricingFormulaScan";
import { clampRowBloat } from "./pricingClamp";
import {
	emptyReport,
	finalizeReport,
	runFormulaStage,
	summarize,
	type ImportReport,
} from "./pricingTransforms";
import { ImportReportDialog, reportIsNoop } from "./ImportReportDialog";
import { REASON_NEEDS_HELPER, applyHelperFixesOffline, applyLiveFix, assessHit } from "./pricingLiveFix";
import { attachDataValidations } from "./pricingValidations";
import { installDropdownSearch } from "./pricingDropdownSearch";
import { workbookForPath } from "./pricingWorkbooks";
import { pricingRootClass, shouldExitPricingFullscreenOnEsc } from "./pricingHelpers";
// Dropdown cap (DIAG 2026-07-27): a bare-ID rule capping the Luckysheet
// data-validation dropdown list to 300px + overflow-y:auto, so long
// range-sourced lists scroll internally instead of rendering at full
// content height (unscrollable, JS-placed off-screen). See pricing.css.
import "./pricing.css";

declare global {
	interface Window {
		luckysheet: any;
		LuckyExcel: any;
		/** The engine's own function registry -- see pricingFormulaScan. */
		luckysheet_function: any;
	}
}

// Shared across the three pages: only ONE ever mounts at a time (each workbook is
// its own route object, so switching fully unmounts the previous page and the
// cleanup effect destroys the engine before the next create).
const CONTAINER_ID = "pricing-workbook-luckysheet";
const M = "nirmaan_stack.api.pricing.workbook";

/** Cap the advisory dialog's list; the rest are summarised as a count. */
const MAX_LISTED_HITS = 25;

/**
 * A hit that the single "Fix all & save" action can fix (PW-2d v2 amendment): helper-FREE
 * (rewritten in the live engine) OR helper-CLASS (materialized offline). Only a genuinely
 * un-rewritable hit -- no sanctioned rewrite, or a declined inline array literal -- is saved
 * as-is. Drives both the per-row status label and the footer's single primary action.
 */
function isAutoFixable(hit: FormulaScanHit): boolean {
	const a = assessHit(hit);
	return a.fixable || a.reason === REASON_NEEDS_HELPER;
}

type PageStatus =
	| "loading" // scripts + first data read in flight
	| "empty" // no workbook with THIS title yet -> import
	| "ready" // workbook loaded into the sheet
	| "scripts-error"
	| "access-denied"
	| "unknown-workbook" // route path not in the registry
	| "error";

type LockState = "readonly" | "mine" | "locked-by-other";

/**
 * A write the user has been asked to confirm. Carries the ALREADY-SERIALIZED sheets
 * so the confirm path posts exactly what was scanned -- it must not re-run the FR-6
 * re-entry pass (another 400 ms, and it would re-touch the live engine).
 */
type PendingAction =
	| { kind: "save"; sheets: any[]; hits: FormulaScanHit[] }
	// PW-2b-ii: replace and import carry the pipeline's ImportReport (shown in the
	// merged confirm), NOT the advisory scan -- the report's `abstained` list already
	// surfaces the cells the pipeline could not fix.
	| { kind: "replace"; sheets: any[]; report: ImportReport; fileName: string }
	| { kind: "import"; sheets: any[]; report: ImportReport; fileName: string };

function isPermissionError(err: any): boolean {
	const status = err?.httpStatus ?? err?.httpStatusCode;
	if (status === 403) return true;
	const blob = `${err?.exc_type ?? ""} ${err?.message ?? ""} ${err?._server_messages ?? ""}`;
	return /PermissionError/i.test(blob);
}

/** Pull the real Frappe message out of a failed fetch Response. */
async function messageFromResponse(res: Response, fallback: string): Promise<string> {
	try {
		const data = await res.json();
		if (data?._server_messages) {
			const parsed = JSON.parse(data._server_messages);
			return (
				parsed
					.map((m: string) => {
						try {
							return JSON.parse(m).message;
						} catch {
							return String(m);
						}
					})
					.join(" ") || fallback
			);
		}
		if (typeof data?.message === "string") return data.message;
	} catch {
		/* non-JSON body -> keep the fallback */
	}
	return fallback;
}

function csrfToken(): string {
	return (window as any).frappe?.csrf_token || (window as any).csrf_token || "";
}

export function PricingWorkbookPage() {
	const { full_name, user_id, role } = useUserData();
	const { pathname } = useLocation();

	// WHICH workbook this page is. Each registry path is its own route object, so
	// this is fixed for the life of the mount (switching workbooks remounts).
	const entry = useMemo(() => workbookForPath(pathname), [pathname]);
	const workbookTitle = entry?.title ?? "";

	// -- role (PW-2a) ------------------------------------------------------
	// `useUserData` reads user_id from a cookie and `role` from the Nirmaan Users
	// doc, so `role` is transiently the literal "Loading" while that doc resolves.
	// Rendering the action bar before it settles would flash the estimation bar at
	// an admin, so the bar waits on roleResolved.
	//
	// CLIENT GATING IS UX ONLY. The authority is the backend write gate
	// (_require_pricing_write_access in api/pricing/workbook.py); nothing here is a
	// security boundary, and the page still handles a server refusal.
	const roleResolved = role !== "Loading";
	const isPricingAdmin = user_id === "Administrator" || role === "Nirmaan Admin Profile";

	const [status, setStatus] = useState<PageStatus>("loading");
	const [errorMsg, setErrorMsg] = useState<string>("");
	const [lock, setLock] = useState<LockState>("readonly");
	const [holder, setHolder] = useState<string>("");
	const [holderSince, setHolderSince] = useState<string>("");
	const [savedAt, setSavedAt] = useState<string>("");
	const [busy, setBusy] = useState<boolean>(false);
	// PW-2a: local, never-persisted edit session. Independent of `lock` by design.
	const [sandbox, setSandbox] = useState<boolean>(false);
	// PW-2a: a write awaiting the user's confirmation (advisory and/or replace).
	const [pending, setPending] = useState<PendingAction | null>(null);
	// PW-2b-ii: the LAST import/replace report, re-openable from the action bar.
	// Session-only -- persistence across reloads is deferred.
	const [lastReport, setLastReport] = useState<{ report: ImportReport; fileName: string } | null>(
		null
	);
	const [viewingReport, setViewingReport] = useState<boolean>(false);
	// PW-FS: full-screen / maximize (per-session). When true the page ROOT wrapper
	// becomes a fixed inset-0 overlay covering the app shell. Pure LAYOUT -- it flips
	// ONLY the root className (one JSX tree, same children, same engine container id),
	// so nothing remounts: the Luckysheet instance, the checkout lock, the sandbox
	// session and the watermark sibling all survive. NOT a Dialog / portal (those
	// remount + would strand the watermark), NOT the native Fullscreen API (Radix
	// dialogs portal to document.body and would be hidden behind a fullscreened node).
	const [expanded, setExpanded] = useState<boolean>(false);

	// Post-mount (re)create request. The actual luckysheet.create runs from the
	// effect below, which fires only when status === "ready" so the container div
	// (rendered only in the non-empty branch) is guaranteed mounted. `nonce`
	// makes each request a fresh object so re-inits (edit/release) re-fire.
	const [renderReq, setRenderReq] = useState<{
		sheets: any[];
		allowEdit: boolean;
		nonce: number;
	} | null>(null);

	// Refs that must survive re-renders / be readable in unmount cleanup.
	const workbookNameRef = useRef<string>("");
	const sheetInitedRef = useRef<boolean>(false);
	const lockMineRef = useRef<boolean>(false);
	const nonceRef = useRef<number>(0);

	const { call: callList } = useFrappePostCall(`${M}.list_workbooks`);
	const { call: callGet } = useFrappePostCall(`${M}.get_workbook`);
	const { call: callCheckout } = useFrappePostCall(`${M}.checkout`);
	const { call: callRelease } = useFrappePostCall(`${M}.release`);
	// NOTE: create_workbook / save_workbook are NOT on the SDK -- they take a
	// gzipped multipart body; see the raw fetches below (FR-3 / FR-5).

	const watermarkStyle = useMemo(
		() => ({ backgroundImage: watermarkBackground(full_name || "", user_id || "") }),
		[full_name, user_id]
	);

	// -- luckysheet lifecycle ---------------------------------------------
	const destroySheet = useCallback(() => {
		try {
			if (sheetInitedRef.current && window.luckysheet?.destroy) {
				window.luckysheet.destroy();
			}
		} catch {
			/* best-effort */
		}
		sheetInitedRef.current = false;
	}, []);

	const initSheet = useCallback(
		(sheets: any[], allowEdit: boolean) => {
			destroySheet();
			window.luckysheet.create({
				container: CONTAINER_ID,
				data: sheets && sheets.length ? sheets : undefined,
				title: workbookTitle,
				lang: "en",
				allowEdit,
				showinfobar: false,
				// Toolbar is always visible (read-only OR edit); edit-only actions
				// stay gated by allowEdit. Other bars keep luckysheet defaults.
				showtoolbar: true,
				enableAddRow: allowEdit,
				enableAddBackTop: false,
				// NEVER set `allowUpdate: true` (the engine default is false, which is
				// why it is not passed here). With it on, the engine begins POSTing
				// its own deltas to `updateUrl` autonomously -- outside the checkout
				// lock, outside save_workbook, and outside the Sandbox guarantee that
				// nothing is persisted. The whole single-editor model assumes the ONLY
				// path to the server is this page's explicit Save.
			});
			sheetInitedRef.current = true;
		},
		[destroySheet, workbookTitle]
	);

	// Request a (re)create of the sheet. Never calls luckysheet.create directly --
	// the post-mount effect does, once the container is guaranteed mounted.
	const requestSheet = useCallback((sheets: any[], allowEdit: boolean) => {
		nonceRef.current += 1;
		setRenderReq({ sheets, allowEdit, nonce: nonceRef.current });
	}, []);

	// Post-mount sheet (re)init. Runs ONLY when status === "ready", so the
	// container div (rendered only in the non-empty branch) exists -- this makes
	// the empty-state pre-mount crash impossible and unifies every create path
	// (load / import / edit / release) behind one mounted-container gate.
	useEffect(() => {
		if (status === "ready" && renderReq) {
			initSheet(renderReq.sheets, renderReq.allowEdit);
		}
	}, [status, renderReq, initSheet]);

	// -- initial load: inject libs, list, load first workbook -------------
	useEffect(() => {
		let cancelled = false;
		// An unregistered path has no workbook to load -- surface it instead of
		// falling through to a blank page.
		if (!entry) {
			setStatus("unknown-workbook");
			return;
		}
		(async () => {
			try {
				await loadPricingLibs();
			} catch (e: any) {
				if (!cancelled) {
					setErrorMsg(e?.message || "Failed to load the pricing engine.");
					setStatus("scripts-error");
				}
				return;
			}
			try {
				const listed = await callList({});
				const rows: any[] = listed?.message || [];
				// PW-1: select BY TITLE, not by list position. `title` is unique on the
				// Pricing Workbook doctype, so this is an exact 0-or-1 match, and "no
				// match" means empty FOR THIS PAGE -- other workbooks existing is
				// irrelevant here (that global check is what made import unreachable).
				const match = rows.find((r: any) => r.title === entry.title);
				if (!match) {
					if (!cancelled) setStatus("empty");
					return;
				}
				const name: string = match.name;
				workbookNameRef.current = name;
				const got = await callGet({ name });
				const wb = got?.message || {};
				const sheets = wb.workbook_json ? JSON.parse(wb.workbook_json) : [];
				if (cancelled) return;
				// Page loads read-only first (spec 2d). The create runs from the
				// post-mount effect once status flips to "ready".
				requestSheet(sheets, false);
				setLock("readonly");
				if (wb.checked_out_by && !wb.lock_is_mine && !wb.lock_expired) {
					setHolder(wb.checked_out_by);
					setHolderSince(wb.checked_out_at || "");
				}
				setStatus("ready");
			} catch (e: any) {
				if (cancelled) return;
				if (isPermissionError(e)) {
					setStatus("access-denied");
				} else {
					setErrorMsg(e?.message || "Failed to load the workbook.");
					setStatus("error");
				}
			}
		})();
		return () => {
			cancelled = true;
		};
		// Runs ONCE per mount. Safe because every registry path is its own route
		// object, so switching workbooks unmounts this page (and the cleanup effect
		// below releases the lock + destroys the engine) rather than re-rendering it
		// with a different `entry`.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// -- best-effort release on unmount + tab close -----------------------
	// NOTE (PW-2a): the `lockMineRef` guard is also what makes SANDBOX safe -- a
	// sandbox session never enters handleEdit, so the ref stays false and neither
	// the beacon nor the unmount call fires. Do not replace this guard with a
	// `sandbox` condition; the ref is the single truth for "do I hold the lock".
	useEffect(() => {
		const releaseBeacon = () => {
			if (!lockMineRef.current || !workbookNameRef.current) return;
			const token = csrfToken();
			try {
				void fetch(`/api/method/${M}.release`, {
					method: "POST",
					keepalive: true,
					headers: {
						"Content-Type": "application/json",
						"X-Frappe-CSRF-Token": token,
					},
					body: JSON.stringify({ name: workbookNameRef.current }),
				});
			} catch {
				/* fire-and-forget */
			}
		};
		window.addEventListener("beforeunload", releaseBeacon);
		return () => {
			window.removeEventListener("beforeunload", releaseBeacon);
			releaseBeacon();
			destroySheet();
		};
	}, [destroySheet]);

	// -- PW-FS: full-screen Esc-to-exit -----------------------------------
	// A window keydown listener mounted ONLY while expanded. shouldExitPricingFullscreenOnEsc
	// guards the collision cases (a dropdown/popup that already consumed the Esc via
	// defaultPrevented, and an <input>/<textarea> cell editor being typed).
	useEffect(() => {
		if (!expanded) return;
		const onKeyDown = (e: KeyboardEvent) => {
			if (shouldExitPricingFullscreenOnEsc(e, document.activeElement)) setExpanded(false);
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [expanded]);

	// -- PW-FS: repaint the engine canvas after the container size flips --
	// Luckysheet sizes its canvas at create() and only re-measures on its OWN window-resize
	// listener. A className flip changes the CONTAINER box but NOT the window, so that
	// listener never fires and the canvas keeps the old size (blank/clipped band, misplaced
	// scrollbars) until told otherwise. Call luckysheet.resize() on BOTH directions, after
	// the browser has laid out the new box (rAF -- the class change is not settled in the
	// same tick). Guarded on sheetInitedRef so it no-ops before the engine exists.
	useEffect(() => {
		if (!sheetInitedRef.current) return;
		const id = requestAnimationFrame(() => window.luckysheet?.resize?.());
		return () => cancelAnimationFrame(id);
	}, [expanded]);

	// -- PW-DS: type-to-search in data-validation dropdowns ---------------
	// App-level DOM augmentation over the vendored engine (NO vendored change): a
	// MutationObserver watches for the dropdown popup to open and prepends a search
	// input that filters the option rows. Installed once per page mount, torn down on
	// unmount. Body-scoped + engine-agnostic, so it survives every re-init (edit /
	// release / sandbox / import). See pricingDropdownSearch.ts.
	useEffect(() => {
		const uninstall = installDropdownSearch();
		return uninstall;
	}, []);

	// -- actions -----------------------------------------------------------
	const reloadSheet = useCallback(
		async (allowEdit: boolean) => {
			const got = await callGet({ name: workbookNameRef.current });
			const wb = got?.message || {};
			const sheets = wb.workbook_json ? JSON.parse(wb.workbook_json) : [];
			requestSheet(sheets, allowEdit);
			return wb;
		},
		[callGet, requestSheet]
	);

	/** The engine's supported-function set, or null when unavailable (fail-open). */
	const engineSupported = useCallback(
		() => supportedFunctionsFromEngine(window.luckysheet_function),
		[]
	);

	const handleEdit = useCallback(async () => {
		setBusy(true);
		setErrorMsg("");
		try {
			await callCheckout({ name: workbookNameRef.current });
			await reloadSheet(true);
			lockMineRef.current = true;
			setLock("mine");
			setHolder("");
			setHolderSince("");
		} catch (e: any) {
			if (isPermissionError(e)) {
				setStatus("access-denied");
				return;
			}
			// DIAG-3: never mislabel a transient / non-lock failure as "locked by
			// another". Re-fetch the TRUE lock state and only claim a conflict when
			// someone ELSE genuinely holds a live (non-expired) lock.
			let heldBy: string | null = null;
			let heldAt: string | null = null;
			let expired = true;
			let mine = false;
			try {
				const got = await callGet({ name: workbookNameRef.current });
				const wb = got?.message || {};
				heldBy = wb.checked_out_by || null;
				heldAt = wb.checked_out_at || null;
				expired = !!wb.lock_expired;
				mine = !!wb.lock_is_mine;
			} catch {
				/* fall through to the generic-error branch */
			}
			if (heldBy && !mine && !expired) {
				// Genuine conflict: another user holds a live lock.
				setHolder(heldBy);
				setHolderSince(heldAt || "");
				setLock("locked-by-other");
			} else {
				// Free / expired / already-mine, but checkout still failed -> surface
				// the REAL error and keep Edit available (retryable). No phantom lock.
				setErrorMsg(e?.message || "Could not acquire the edit lock. Please try again.");
				setLock("readonly");
			}
		} finally {
			setBusy(false);
		}
	}, [callCheckout, callGet, reloadSheet]);

	// -- sandbox (PW-2a) ---------------------------------------------------
	// A local scratch session: the sheet becomes editable WITHOUT any checkout, so
	// nothing is persisted and no other user is locked out. Available to admins and
	// estimation users alike (owner decision). The re-init is the same requestSheet
	// path every other mode uses -- only the allowEdit flag differs.
	const handleEnterSandbox = useCallback(async () => {
		setBusy(true);
		setErrorMsg("");
		try {
			// Re-read from the server so the scratch session starts from current
			// content rather than whatever is on screen.
			await reloadSheet(true);
			setSandbox(true);
		} catch (e: any) {
			if (isPermissionError(e)) setStatus("access-denied");
			else setErrorMsg(e?.message || "Could not start a sandbox session.");
		} finally {
			setBusy(false);
		}
	}, [reloadSheet]);

	// Exit by RE-FETCHING rather than re-rendering a cached copy of the sheets: the
	// engine may mutate the array it was created with, so a kept reference is not a
	// trustworthy "pristine" snapshot. The server copy always is.
	const handleExitSandbox = useCallback(async () => {
		setBusy(true);
		try {
			await reloadSheet(false);
		} catch {
			/* best-effort: the flag still clears, and the bar returns to read-only */
		} finally {
			setSandbox(false);
			setBusy(false);
		}
	}, [reloadSheet]);

	// -- save --------------------------------------------------------------
	/**
	 * POST an already-serialized + already-scanned workbook. Split out of the click
	 * handler so the advisory dialog's Continue can post the SAME payload that was
	 * scanned, without re-running the re-entry pass.
	 */
	const performSave = useCallback(async (sheets: any[]) => {
		setBusy(true);
		try {
			// GZIP + MULTIPART, the ONE transport for save (FR-5). Same-origin fetch +
			// CSRF header (PM-6). This replaced the nested-JSON body entirely: nesting
			// the workbook as a JSON *string* escaped every quote (1.23x -> 25.91 MB for
			// Electrical) and blew past the site's 25 MiB limit; gzip takes the same
			// payload to a few MB. There is deliberately NO non-gzip fallback.
			const form = await buildWorkbookForm(JSON.stringify(sheets), {
				name: workbookNameRef.current,
			});
			const res = await fetch(`/api/method/${M}.save_workbook`, {
				method: "POST",
				headers: { "X-Frappe-CSRF-Token": csrfToken() }, // no Content-Type: the browser sets the boundary
				body: form,
			});
			if (!res.ok) {
				// Surface the REAL Frappe message (keeps lock + Edit state intact).
				throw new Error(await messageFromResponse(res, `Save failed (HTTP ${res.status}).`));
			}
			setSavedAt(new Date().toLocaleTimeString());
		} catch (e: any) {
			setErrorMsg(e?.message || "Save failed.");
		} finally {
			setBusy(false);
		}
	}, []);

	const handleSaveClick = useCallback(async () => {
		setBusy(true);
		setErrorMsg("");
		try {
			// FR-6: push any formula the normalizer would change back through the ENGINE
			// FIRST, so it recomputes a real value. Without this we would persist a
			// corrected `f` next to a stale "#NAME?" `v`, and since the engine never
			// evaluates at load, a dependency-free formula would read #NAME? forever.
			const reentered = reenterNormalizedFormulas(window.luckysheet);
			if (reentered.length) {
				// Give the engine a moment to finish recomputing before we snapshot.
				await new Promise((r) => setTimeout(r, 400));
			}
			// Compact the payload (strip rebuilt/runtime grid keys, PM-5); the
			// normalizer inside serializeSheets is now the final guard and should be a
			// no-op after the re-entry pass above.
			const sheets = serializeSheets(window.luckysheet.getAllSheets());
			// PW-2a advisory: scan AFTER serializeSheets, so what we warn about is
			// exactly what would be persisted. Warn-only -- Continue still saves.
			const hits = scanWorkbookFormulas(sheets, engineSupported());
			if (hits.length) {
				setPending({ kind: "save", sheets, hits });
				return;
			}
			await performSave(sheets);
		} catch (e: any) {
			setErrorMsg(e?.message || "Save failed.");
		} finally {
			setBusy(false);
		}
	}, [engineSupported, performSave]);

	// -- live fix (PW-2b-ii) ----------------------------------------------
	/**
	 * Re-run the FR-6 re-entry + serialize + scan against the LIVE engine. Called after
	 * a fix so the advisory list and the to-be-saved payload both reflect the fixed
	 * cells -- the fixed content rides the SAME save, no separate cycle.
	 */
	const rescanLive = useCallback((): { sheets: any[]; hits: FormulaScanHit[] } => {
		const reentered = reenterNormalizedFormulas(window.luckysheet);
		if (reentered.length) {
			/* the engine recomputes synchronously enough for the scan; save re-checks */
		}
		const sheets = serializeSheets(window.luckysheet.getAllSheets());
		const hits = scanWorkbookFormulas(sheets, engineSupported());
		return { sheets, hits };
	}, [engineSupported]);

	// PW-2d Option 3 (single-action dialog): "Fix all & save". Applies EVERY fixable hit
	// then saves ONCE. The sequence, in order:
	//   1. helper-FREE fixes into the LIVE engine first (guarded -- CAUTION #6).
	//   2. ONE rescanLive -> the serialized payload (user edits + free fixes).
	//   3. helper-CLASS hits fixed OFFLINE on that payload: materialize the helper columns with
	//      pipeline-computed values + rewrite each hit, and store the hit's EXACT value where it
	//      can be computed from the just-built helpers (else blank until recalc). NEVER a live
	//      setCellValue on a non-active sheet -- that corrupts the sheet (CAUTION #6, abandoned
	//      Option B); and NEVER a global refreshFormula -- it force-evaluates every formula and
	//      cascades #NAME? across the workbook (CAUTION #7, abandoned step-6 re-entry).
	//   4. ONE performSave (single version bump): user edits + free fixes + materialized helpers.
	//   5. if any helper-class rewrite happened, re-init from the fixed sheets so the helpers LOAD
	//      and the stored values DISPLAY (create() renders cached values -- no recompute, no #NAME?).
	//   6. lastReport = the save-fix report.
	const handleFixAndSave = useCallback(async () => {
		if (!pending || pending.kind !== "save") return;
		setBusy(true);
		setErrorMsg("");
		try {
			// 1. helper-FREE fixes first, guarded, in the live engine.
			for (const hit of pending.hits) {
				if (assessHit(hit).fixable) applyLiveFix(window.luckysheet, hit);
			}
			// 2. ONE rescanLive -> serialized payload.
			const { sheets, hits } = rescanLive();
			// 3. helper-CLASS hits fixed OFFLINE on the payload.
			const helperHits = hits.filter((h) => {
				const a = assessHit(h);
				return !a.fixable && a.reason === REASON_NEEDS_HELPER;
			});
			const { sheets: fixedSheets, report, rewrites } = applyHelperFixesOffline(sheets, helperHits);
			// 4. ONE save (single version bump).
			await performSave(fixedSheets);
			// 5. Re-init from the fixed sheets so the helpers + stored values display.
			if (rewrites.length) requestSheet(fixedSheets, true);
			// 6. report.
			setLastReport({ report, fileName: workbookTitle });
			setPending(null);
		} catch (e: any) {
			setErrorMsg(e?.message || "Fix and save failed.");
		} finally {
			setBusy(false);
		}
	}, [pending, rescanLive, performSave, requestSheet, workbookTitle]);

	const handleRelease = useCallback(async () => {
		setBusy(true);
		try {
			await callRelease({ name: workbookNameRef.current });
		} catch {
			/* best-effort */
		} finally {
			lockMineRef.current = false;
			await reloadSheet(false);
			setLock("readonly");
			setSavedAt("");
			setBusy(false);
		}
	}, [callRelease, reloadSheet]);

	// -- import pipeline (shared by create + replace) -----------------------
	/**
	 * The FULL import pipeline, promisified so BOTH the empty-state create and the
	 * replace run byte-identical conversions. THE AUTHORITATIVE STAGE ORDER (PW-2b-i)
	 * -- every position below is load-bearing, not stylistic:
	 *
	 *  1. decodeSheetNames (FR-1) -- FIRST, always. LuckyExcel HTML-escapes sheet
	 *     NAMES but not formula text, so a sheet arrives as "Wiring &amp; cabling"
	 *     while formulas say 'Wiring & cabling'!F2. Every later stage that reads or
	 *     rewrites a sheet-qualified reference needs the decoded name.
	 *  2. clampRowBloat (PW-2b-i) -- SECOND, and this is a PERFORMANCE PRECONDITION.
	 *     The raw ELV export converts to 1,819,874 cells of which 98.8% are
	 *     style-only filler; every later stage walks celldata. Clamping first is the
	 *     difference between a responsive import and a multi-second stall.
	 *  3. normalizeFormulas (FR-3/FR-5) -- before the parser, so it never meets a raw
	 *     newline mid-token. Pure whitespace, so it cannot change meaning.
	 *  4-6. runFormulaStage (PW-2b-i) -- freezeDeadGoogle, then the transform suite,
	 *     then helper-column materialization. One parse per formula.
	 *  7. attachDataValidations (DV-2) -- LAST. It must follow decodeSheetNames
	 *     (sheet matching uses decoded names) and, load-bearingly, the CLAMP: it
	 *     clamps each dropdown's source range to the sheet's data extent + 5, so
	 *     running it against the bloated grid would clamp to ~50,503 instead of ~30
	 *     and reinstate the 50k-iteration-per-dropdown cost DV-2 exists to avoid.
	 *     Never throws: dropdowns are an enhancement, not the payload.
	 *
	 * Returns the sheets AND the ImportReport -- the report is the data contract the
	 * PW-2b-ii dialog will render; for now callers log its summary.
	 */
	const runImportPipeline = useCallback(
		(file: File): Promise<{ sheets: any[]; report: ImportReport }> => {
			return new Promise((resolve, reject) => {
				try {
					window.LuckyExcel.transformExcelToLucky(file, async (exportJson: any) => {
						try {
							if (!exportJson?.sheets?.length) {
								throw new Error("The selected file has no readable sheets.");
							}
							const report = emptyReport();
							const sheets = decodeSheetNames(exportJson.sheets); // 1
							report.clamp = clampRowBloat(sheets); // 2
							normalizeFormulas(sheets); // 3
							const stage = runFormulaStage(sheets); // 4-6
							report.transforms = stage.transforms;
							report.frozen = stage.frozen;
							report.abstained = stage.abstained;
							report.helpers = stage.helpers;
							finalizeReport(report);
							const dvCount = await attachDataValidations(file, sheets); // 7
							if (dvCount) console.log(`[pricing] attached ${dvCount} dropdown records`);
							resolve({ sheets, report });
						} catch (e) {
							reject(e);
						}
					});
				} catch (e) {
					reject(e);
				}
			});
		},
		[]
	);

	/** Console receipt until the PW-2b-ii dialog lands. */
	const logReport = useCallback((report: ImportReport, label: string) => {
		console.log(`[pricing] ${label}: ${summarize(report)}`);
		if (report.abstained.length) {
			console.log(
				`[pricing] declined (left untouched): ` +
					report.abstained.map((a) => `${a.sheet}!${a.cell} (${a.reason})`).join("; ")
			);
		}
		if (report.helpers.length) {
			console.log(
				`[pricing] helper columns: ` +
					report.helpers.map((h) => `${h.sheet}!${h.keyCol}:${h.valCol}`).join(", ")
			);
		}
	}, []);

	/**
	 * Commit a converted-and-serialized workbook via create_workbook. Split from the
	 * convert step so a non-trivial ImportReport can gate it behind the confirm dialog.
	 * `sheets` is the COMPACT (serialized) form -- PM-5.
	 */
	const performImport = useCallback(
		async (sheets: any[]) => {
			setBusy(true);
			try {
				// GZIP + MULTIPART (FR-5), created under THIS page's registry title so the
				// next title-keyed load finds it. Lossless: the engine rebuilds `data`
				// from `celldata` on load.
				const form = await buildWorkbookForm(JSON.stringify(sheets), {
					title: workbookTitle,
				});
				const res = await fetch(`/api/method/${M}.create_workbook`, {
					method: "POST",
					headers: { "X-Frappe-CSRF-Token": csrfToken() }, // browser sets the multipart boundary
					body: form,
				});
				if (!res.ok) {
					throw new Error(
						await messageFromResponse(res, `Import failed (HTTP ${res.status}).`)
					);
				}
				const created = await res.json();
				workbookNameRef.current = created?.message?.name || "";
				// Defer create to the post-mount effect: setting status "ready" mounts the
				// container, then the effect runs luckysheet.create.
				requestSheet(sheets, false);
				setLock("readonly");
				setStatus("ready");
			} catch (e: any) {
				if (isPermissionError(e)) setStatus("access-denied");
				else setErrorMsg(e?.message || "Import failed.");
			} finally {
				setBusy(false);
			}
		},
		[requestSheet, workbookTitle]
	);

	const handleImport = useCallback(
		async (file: File) => {
			setBusy(true);
			setErrorMsg("");
			try {
				const { sheets: converted, report } = await runImportPipeline(file);
				logReport(report, `import ${file.name}`);
				const sheets = serializeSheets(converted);
				// A non-trivial report gates the create behind the confirm dialog; a pure
				// no-op imports directly (today's behaviour).
				if (!reportIsNoop(report)) {
					setPending({ kind: "import", sheets, report, fileName: file.name });
					return;
				}
				await performImport(sheets);
			} catch (e: any) {
				if (isPermissionError(e)) setStatus("access-denied");
				else setErrorMsg(e?.message || "Import failed.");
			} finally {
				setBusy(false);
			}
		},
		[logReport, performImport, runImportPipeline]
	);

	// -- replace from excel (PW-2a, admin + lock held) ----------------------
	/**
	 * Convert the picked file and ASK first. Nothing is sent until the user confirms
	 * -- a replace discards unsaved in-engine edits and swaps the entire sheet set.
	 * The advisory scan runs on the converted payload so one dialog covers both.
	 */
	const handleReplacePick = useCallback(
		async (file: File) => {
			setBusy(true);
			setErrorMsg("");
			try {
				const { sheets: converted, report } = await runImportPipeline(file);
				logReport(report, `replace ${file.name}`);
				// Compact FIRST: this is both what gets posted and what gets rendered
				// (the engine rebuilds `data` from `celldata`), so payload and render are
				// the same array. The dialog shows the pipeline's ImportReport (its
				// `abstained` list is the "could not fix" surface) -- no separate advisory
				// scan on a replace, the pipeline already handled the fixable constructs.
				const sheets = serializeSheets(converted);
				setPending({ kind: "replace", sheets, report, fileName: file.name });
			} catch (e: any) {
				if (isPermissionError(e)) setStatus("access-denied");
				else setErrorMsg(e?.message || "Could not read that Excel file.");
			} finally {
				setBusy(false);
			}
		},
		[logReport, runImportPipeline]
	);

	const performReplace = useCallback(
		async (sheets: any[]) => {
			setBusy(true);
			try {
				// Refresh the lock BEFORE posting. Converting a large .xlsx can take
				// minutes and the server lock auto-expires at 30; checkout is idempotent
				// for the current holder (the "held by someone else" branch is skipped)
				// and re-stamps checked_out_at, so this buys a full window for the POST.
				await callCheckout({ name: workbookNameRef.current });
				// save_workbook, NOT create_workbook: `title` is unique on the doctype,
				// so a second create would fail -- and save gives us the previous content
				// as a version snapshot for free.
				const form = await buildWorkbookForm(JSON.stringify(sheets), {
					name: workbookNameRef.current,
				});
				const res = await fetch(`/api/method/${M}.save_workbook`, {
					method: "POST",
					headers: { "X-Frappe-CSRF-Token": csrfToken() },
					body: form,
				});
				if (!res.ok) {
					throw new Error(
						await messageFromResponse(res, `Replace failed (HTTP ${res.status}).`)
					);
				}
				// Show the replacement. The lock is still held, so stay editable.
				requestSheet(sheets, true);
				setSavedAt(new Date().toLocaleTimeString());
			} catch (e: any) {
				if (isPermissionError(e)) setStatus("access-denied");
				else setErrorMsg(e?.message || "Replace failed.");
			} finally {
				setBusy(false);
			}
		},
		[callCheckout, requestSheet]
	);

	// -- pending-action dialog ---------------------------------------------
	const handlePendingConfirm = useCallback(async () => {
		const action = pending;
		setPending(null);
		if (!action) return;
		if (action.kind === "save") {
			await performSave(action.sheets);
			return;
		}
		// import / replace: remember the report so it can be re-opened, then commit.
		setLastReport({ report: action.report, fileName: action.fileName });
		if (action.kind === "import") await performImport(action.sheets);
		else await performReplace(action.sheets);
	}, [pending, performImport, performReplace, performSave]);

	// -- render ------------------------------------------------------------
	if (status === "unknown-workbook") {
		return (
			<div className="flex items-center justify-center h-[50vh]">
				<div className="text-center max-w-md">
					<h2 className="text-xl font-semibold text-destructive">Unknown pricing workbook</h2>
					<p className="text-muted-foreground mt-2 break-words">
						No pricing workbook is configured for <code>{pathname}</code>.
					</p>
				</div>
			</div>
		);
	}

	if (status === "access-denied") {
		return (
			<div className="flex items-center justify-center h-[50vh]">
				<div className="text-center">
					<h2 className="text-xl font-semibold text-foreground">Access Denied</h2>
					<p className="text-muted-foreground mt-2">
						You don't have permission to access the Pricing Module.
					</p>
				</div>
			</div>
		);
	}

	if (status === "scripts-error" || status === "error") {
		return (
			<div className="flex items-center justify-center h-[50vh]">
				<div className="text-center max-w-md">
					<h2 className="text-xl font-semibold text-destructive">
						{status === "scripts-error" ? "Pricing engine failed to load" : "Something went wrong"}
					</h2>
					<p className="text-muted-foreground mt-2 break-words">{errorMsg}</p>
				</div>
			</div>
		);
	}

	// Admin-only affordances. `lock === "mine"` is already unreachable for a
	// non-admin (checkout is server-refused), but the flag is ANDed in explicitly so
	// the intent is readable at each call site rather than inferred.
	const showEdit = roleResolved && isPricingAdmin && status === "ready" && !sandbox && lock === "readonly";
	const showEditorActions = roleResolved && isPricingAdmin && status === "ready" && lock === "mine";
	// Sandbox is offered to BOTH roles (owner decision), in any state where the user
	// is not the active server-side editor.
	const showSandboxEntry = roleResolved && status === "ready" && !sandbox && lock !== "mine";

	return (
		// PW-FS: ONE JSX tree -- only THIS wrapper's className flips (normal <-> fixed
		// inset-0 overlay). The action bar + sandbox band stay the fixed-height first
		// children and the sheet slot keeps flex-1, so no child remounts and the engine
		// container / watermark siblings are untouched.
		<div className={pricingRootClass(expanded)}>
			<div className="flex flex-wrap items-center gap-2 p-2 border-b border-border">
				<h1 className="text-base font-semibold text-foreground mr-2">{workbookTitle}</h1>

				{/* PW-FS: full-screen toggle -- ALWAYS rendered once a sheet exists
				    (ready/loading), orthogonal to editability / sandbox. */}
				{(status === "ready" || status === "loading") && (
					<Button
						size="sm"
						variant="outline"
						className="gap-1.5"
						aria-pressed={expanded}
						onClick={() => setExpanded((v) => !v)}
						title={expanded ? "Exit full screen (Esc)" : "Expand the editor to full screen"}
					>
						{expanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
						{expanded ? "Exit full screen" : "Full screen"}
					</Button>
				)}

				{!roleResolved && (
					// Neutral bar while the role resolves -- never flash the wrong one.
					<span className="text-sm text-muted-foreground">Checking permissions…</span>
				)}

				{showEdit && (
					<Button size="sm" disabled={busy} onClick={handleEdit}>
						Edit
					</Button>
				)}
				{showSandboxEntry && (
					<Button size="sm" variant="outline" disabled={busy} onClick={handleEnterSandbox}>
						Sandbox
					</Button>
				)}
				{roleResolved && status === "ready" && sandbox && (
					<Button size="sm" variant="outline" disabled={busy} onClick={handleExitSandbox}>
						Exit Sandbox
					</Button>
				)}
				{roleResolved && status === "ready" && lock === "readonly" && errorMsg && (
					// A failed checkout on a FREE lock: show the real error, Edit stays retryable.
					<span className="text-sm text-destructive">{errorMsg}</span>
				)}
				{showEditorActions && (
					<>
						<span className="text-sm text-emerald-600 font-medium">
							You hold the edit lock
						</span>
						<Button size="sm" disabled={busy} onClick={handleSaveClick}>
							Save
						</Button>
						<label
							className={`inline-flex items-center px-3 py-1.5 rounded-md border border-input text-sm font-medium ${
								busy ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:bg-accent"
							}`}
						>
							Replace from Excel
							<input
								type="file"
								accept=".xlsx"
								className="hidden"
								disabled={busy}
								onChange={(e) => {
									const file = e.target.files?.[0];
									if (file) void handleReplacePick(file);
									e.target.value = "";
								}}
							/>
						</label>
						<Button size="sm" variant="outline" disabled={busy} onClick={handleRelease}>
							Release
						</Button>
						{lastReport && (
							<button
								type="button"
								className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
								onClick={() => setViewingReport(true)}
							>
								View import report
							</button>
						)}
						{savedAt && (
							<span className="text-xs text-muted-foreground">Saved at {savedAt}</span>
						)}
						{errorMsg && <span className="text-sm text-destructive">{errorMsg}</span>}
					</>
				)}
				{roleResolved && status === "ready" && lock === "locked-by-other" && (
					<span className="text-sm text-amber-600 font-medium">
						Locked by {holder} — read only
						{holderSince ? ` (since ${holderSince.slice(0, 16)} IST)` : ""}
					</span>
				)}
				{roleResolved && status === "ready" && lock === "readonly" && holder && (
					<span className="text-sm text-amber-600 font-medium">
						Currently held by {holder}
						{holderSince ? ` (since ${holderSince.slice(0, 16)} IST)` : ""}
					</span>
				)}
			</div>

			{sandbox && (
				// Persistent for the whole sandbox session -- the one thing standing
				// between a scratch experiment and the belief that it was saved.
				<div className="flex items-center gap-2 px-3 py-1.5 border-b border-amber-300 bg-amber-50 text-amber-900 text-sm dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-800">
					<span className="font-medium">Sandbox — changes are not saved.</span>
					<span className="text-amber-700 dark:text-amber-300">
						Experiment freely; nothing here is written back to the workbook.
					</span>
				</div>
			)}

			{status === "empty" ? (
				<div className="flex-1 flex items-center justify-center">
					<div className="text-center">
						{isPricingAdmin ? (
							<>
								<p className="text-muted-foreground mb-4">
									No <span className="font-medium">{workbookTitle}</span> workbook yet. Import
									an Excel file to get started.
								</p>
								<label className="inline-flex items-center px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium cursor-pointer">
									Import Excel (.xlsx)
									<input
										type="file"
										accept=".xlsx"
										className="hidden"
										disabled={busy}
										onChange={(e) => {
											const file = e.target.files?.[0];
											if (file) void handleImport(file);
											e.target.value = "";
										}}
									/>
								</label>
							</>
						) : (
							<p className="text-muted-foreground">
								No <span className="font-medium">{workbookTitle}</span> workbook has been set up
								yet. An administrator needs to import one.
							</p>
						)}
						{errorMsg && <p className="text-destructive text-sm mt-3">{errorMsg}</p>}
					</div>
				</div>
			) : (
				<div className="relative flex-1">
					<div id={CONTAINER_ID} className="absolute inset-0" />
					{/* Watermark: over the sheet, never blocking interaction. */}
					<div
						aria-hidden
						className="pointer-events-none absolute inset-0 z-10"
						style={watermarkStyle}
					/>
					{status === "loading" && (
						<div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
							Loading pricing workbook…
						</div>
					)}
				</div>
			)}

			{/* Save-time advisory with consent-based live fixing (PW-2a + PW-2b-ii). */}
			<AlertDialog
				open={pending?.kind === "save"}
				onOpenChange={(open) => !open && setPending(null)}
			>
				<AlertDialogContent className="max-w-2xl">
					<AlertDialogHeader>
						<AlertDialogTitle>
							{pending?.kind === "save" && pending.hits.length
								? "Check these formulas before saving"
								: "Ready to save"}
						</AlertDialogTitle>
						<AlertDialogDescription asChild>
							<div className="space-y-3">
								{pending?.kind === "save" && pending.hits.length > 0 ? (
									<>
										<p>
											{pending.hits.length} formula
											{pending.hits.length === 1 ? "" : "s"} may not calculate correctly in the
											pricing engine.{" "}
											{pending.hits.some(isAutoFixable)
												? "The fixable ones are corrected automatically when you save."
												: "None can be fixed automatically — they are saved as-is."}
										</p>
										<div className="max-h-72 overflow-y-auto rounded-md border border-border">
											<table className="w-full text-xs">
												<tbody>
													{pending.hits.slice(0, MAX_LISTED_HITS).map((h, i) => {
														const fixable = isAutoFixable(h);
														return (
															<tr key={`${h.sheet}-${h.cell}-${i}`} className="border-b border-border last:border-0 align-top">
																<td className="px-2 py-1 whitespace-nowrap font-medium text-foreground">
																	{h.sheet} — {h.cell}
																</td>
																<td className="px-2 py-1">
																	<code className="break-all">{h.formula}</code>
																	<div className="text-muted-foreground mt-0.5">
																		{h.reasons.join(" ")}
																	</div>
																</td>
																<td className="px-2 py-1 whitespace-nowrap text-right">
																	{fixable ? (
																		<span className="text-emerald-600 dark:text-emerald-400">
																			will be fixed
																		</span>
																	) : (
																		<span className="text-muted-foreground">
																			no automatic fix — saved as-is
																		</span>
																	)}
																</td>
															</tr>
														);
													})}
												</tbody>
											</table>
										</div>
										{pending.hits.length > MAX_LISTED_HITS && (
											<p className="text-xs text-muted-foreground">
												Showing the first {MAX_LISTED_HITS} of {pending.hits.length}.
											</p>
										)}
									</>
								) : (
									<p>All formulas look good. Save the workbook?</p>
								)}
							</div>
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
						{/* PW-2d v2 amendment: ONE primary action. "Fix all & save" when anything is
						    fixable (helper-free AND helper-class ride the same click); "Save anyway"
						    when hits exist but none are fixable; "Save" when there are no hits. The
						    old per-hit [Fix] / [Fix + save] buttons + save-without-fixing are gone. */}
						{pending?.kind === "save" && pending.hits.length && pending.hits.some(isAutoFixable) ? (
							<AlertDialogAction disabled={busy} onClick={handleFixAndSave}>
								Fix all &amp; save
							</AlertDialogAction>
						) : (
							<AlertDialogAction disabled={busy} onClick={handlePendingConfirm}>
								{pending?.kind === "save" && pending.hits.length ? "Save anyway" : "Save"}
							</AlertDialogAction>
						)}
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			{/* Import / replace confirm, merged with the pipeline's ImportReport (PW-2b-ii). */}
			<ImportReportDialog
				open={pending?.kind === "replace" || pending?.kind === "import"}
				report={pending?.kind === "replace" || pending?.kind === "import" ? pending.report : null}
				fileName={
					pending?.kind === "replace" || pending?.kind === "import" ? pending.fileName : undefined
				}
				variant={pending?.kind === "import" ? "import" : "replace"}
				busy={busy}
				onConfirm={handlePendingConfirm}
				onClose={() => setPending(null)}
			/>

			{/* Re-open the LAST import/replace report (session-only). */}
			<ImportReportDialog
				open={viewingReport && !!lastReport}
				report={lastReport?.report ?? null}
				fileName={lastReport?.fileName}
				variant="view"
				onClose={() => setViewingReport(false)}
			/>
		</div>
	);
}

export { PricingWorkbookPage as Component };
