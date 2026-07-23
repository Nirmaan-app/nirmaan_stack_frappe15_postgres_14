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
import { attachDataValidations } from "./pricingValidations";
import { workbookForPath } from "./pricingWorkbooks";

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
	| { kind: "replace"; sheets: any[]; hits: FormulaScanHit[]; fileName: string };

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
	 * The FULL import pipeline (FR-1 + FR-3 + DV-2), promisified so BOTH the
	 * empty-state create and the PW-2a replace run byte-identical conversions:
	 *  1. decodeSheetNames -- LuckyExcel HTML-escapes sheet names but NOT formula
	 *     text, breaking every cross-sheet reference to a sheet whose name contains
	 *     `&` (DIAG-6 Defect A).
	 *  2. normalizeFormulas -- strip newlines and `++` from formula text; the engine
	 *     cannot parse either (DIAG-6/FR-2 Defects D/E).
	 *  3. attachDataValidations (DV-2) -- LuckyExcel drops every <dataValidation>, so
	 *     re-read the SAME file with the vendored JSZip and attach the engine's
	 *     per-cell dropdown records. Runs AFTER decodeSheetNames because sheet
	 *     matching uses decoded names. Never throws: dropdowns are an enhancement.
	 */
	const runImportPipeline = useCallback((file: File): Promise<any[]> => {
		return new Promise((resolve, reject) => {
			try {
				window.LuckyExcel.transformExcelToLucky(file, async (exportJson: any) => {
					try {
						if (!exportJson?.sheets?.length) {
							throw new Error("The selected file has no readable sheets.");
						}
						const sheets = normalizeFormulas(decodeSheetNames(exportJson.sheets));
						const dvCount = await attachDataValidations(file, sheets);
						if (dvCount) console.log(`[pricing] attached ${dvCount} dropdown records`);
						resolve(sheets);
					} catch (e) {
						reject(e);
					}
				});
			} catch (e) {
				reject(e);
			}
		});
	}, []);

	const handleImport = useCallback(
		async (file: File) => {
			setBusy(true);
			setErrorMsg("");
			try {
				const sheets = await runImportPipeline(file);
				// Created under THIS page's registry title, so the next load's
				// title-keyed selection finds it from this route and no other.
				//
				// GZIP + MULTIPART, the ONE transport for create (FR-5). Persists the
				// COMPACT form (PM-5: every save-shaped path goes through
				// serializeSheets); LuckyExcel's raw output carries the rebuilt `data`
				// grids and is far larger. Lossless: the engine rebuilds `data` from
				// `celldata` on load, and this is the same shape the workbook takes
				// after its first save.
				const form = await buildWorkbookForm(JSON.stringify(serializeSheets(sheets)), {
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
				// Defer create to the post-mount effect: setting status "ready"
				// mounts the container, then the effect runs luckysheet.create.
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
		[requestSheet, runImportPipeline, workbookTitle]
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
				const converted = await runImportPipeline(file);
				// Compact FIRST: this is both what gets posted and what gets rendered
				// (the engine rebuilds `data` from `celldata`), so scan and payload and
				// render are all the same array.
				const sheets = serializeSheets(converted);
				const hits = scanWorkbookFormulas(sheets, engineSupported());
				setPending({ kind: "replace", sheets, hits, fileName: file.name });
			} catch (e: any) {
				if (isPermissionError(e)) setStatus("access-denied");
				else setErrorMsg(e?.message || "Could not read that Excel file.");
			} finally {
				setBusy(false);
			}
		},
		[engineSupported, runImportPipeline]
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
		if (action.kind === "save") await performSave(action.sheets);
		else await performReplace(action.sheets);
	}, [pending, performReplace, performSave]);

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
		<div className="flex flex-col h-[calc(100vh-100px)]">
			<div className="flex flex-wrap items-center gap-2 p-2 border-b border-border">
				<h1 className="text-base font-semibold text-foreground mr-2">{workbookTitle}</h1>

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

			{/* Confirm gate for replace, and the warn-only formula advisory (PW-2a). */}
			<AlertDialog open={!!pending} onOpenChange={(open) => !open && setPending(null)}>
				<AlertDialogContent className="max-w-2xl">
					<AlertDialogHeader>
						<AlertDialogTitle>
							{pending?.kind === "replace"
								? "Replace this workbook?"
								: "Check these formulas before saving"}
						</AlertDialogTitle>
						<AlertDialogDescription asChild>
							<div className="space-y-3">
								{pending?.kind === "replace" && (
									<p>
										This replaces the entire workbook content with{" "}
										<span className="font-medium text-foreground">{pending.fileName}</span>. The
										current content is preserved as version history; any unsaved edits are
										discarded.
									</p>
								)}
								{!!pending?.hits.length && (
									<>
										<p>
											{pending.hits.length} formula
											{pending.hits.length === 1 ? "" : "s"} may not calculate correctly in the
											pricing engine. This is a warning only — you can continue and save.
										</p>
										<div className="max-h-64 overflow-y-auto rounded-md border border-border">
											<table className="w-full text-xs">
												<tbody>
													{pending.hits.slice(0, MAX_LISTED_HITS).map((h, i) => (
														<tr key={`${h.sheet}-${h.cell}-${i}`} className="border-b border-border last:border-0">
															<td className="px-2 py-1 align-top whitespace-nowrap font-medium text-foreground">
																{h.sheet} — {h.cell}
															</td>
															<td className="px-2 py-1 align-top">
																<code className="break-all">{h.formula}</code>
																<div className="text-muted-foreground mt-0.5">
																	{h.reasons.join(" ")}
																</div>
															</td>
														</tr>
													))}
												</tbody>
											</table>
										</div>
										{pending.hits.length > MAX_LISTED_HITS && (
											<p className="text-xs text-muted-foreground">
												Showing the first {MAX_LISTED_HITS} of {pending.hits.length}.
											</p>
										)}
									</>
								)}
							</div>
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
						<AlertDialogAction disabled={busy} onClick={handlePendingConfirm}>
							{pending?.kind === "replace" ? "Replace workbook" : "Save anyway"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}

export { PricingWorkbookPage as Component };
