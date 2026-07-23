// Generic pricing workbook page (PM-2 -> PW-1). ONE module serves every entry in
// the PRICING_WORKBOOKS registry (HVAC / Electrical / ELV); each has its own route
// object, and the page resolves WHICH workbook it is from its own route path.
// Lazy route module -- exports `Component` per the M1.59 lazy() contract. Mounts
// the vendored Luckysheet engine (script-injected, not bundled), reads/writes the
// workbook through the PM-1 whitelisted API, and enforces a single-editor checkout
// lock. Access is gated by <PricingRoute />; the backend API is the real
// enforcement layer.
//
// PW-1 replaced two single-workbook assumptions: selection was `rows[0]` of an
// unfiltered list (a MOVING target -- list_workbooks orders by `modified desc`),
// and the empty state fired on "zero workbooks in the SYSTEM", which made import
// unreachable for every page once any one workbook existed. Both are now keyed on
// the registry entry's `title`, so each page has an independent
// empty -> import -> ready lifecycle.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useFrappePostCall } from "frappe-react-sdk";

import { Button } from "@/components/ui/button";
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
import { attachDataValidations } from "./pricingValidations";
import { workbookForPath } from "./pricingWorkbooks";

declare global {
	interface Window {
		luckysheet: any;
		LuckyExcel: any;
	}
}

// Shared across the three pages: only ONE ever mounts at a time (each workbook is
// its own route object, so switching fully unmounts the previous page and the
// cleanup effect destroys the engine before the next create).
const CONTAINER_ID = "pricing-workbook-luckysheet";
const M = "nirmaan_stack.api.pricing.workbook";

type PageStatus =
	| "loading" // scripts + first data read in flight
	| "empty" // no workbook with THIS title yet -> import
	| "ready" // workbook loaded into the sheet
	| "scripts-error"
	| "access-denied"
	| "unknown-workbook" // route path not in the registry
	| "error";

type LockState = "readonly" | "mine" | "locked-by-other";

function isPermissionError(err: any): boolean {
	const status = err?.httpStatus ?? err?.httpStatusCode;
	if (status === 403) return true;
	const blob = `${err?.exc_type ?? ""} ${err?.message ?? ""} ${err?._server_messages ?? ""}`;
	return /PermissionError/i.test(blob);
}

export function PricingWorkbookPage() {
	const { full_name, user_id } = useUserData();
	const { pathname } = useLocation();

	// WHICH workbook this page is. Each registry path is its own route object, so
	// this is fixed for the life of the mount (switching workbooks remounts).
	const entry = useMemo(() => workbookForPath(pathname), [pathname]);
	const workbookTitle = entry?.title ?? "";

	const [status, setStatus] = useState<PageStatus>("loading");
	const [errorMsg, setErrorMsg] = useState<string>("");
	const [lock, setLock] = useState<LockState>("readonly");
	const [holder, setHolder] = useState<string>("");
	const [holderSince, setHolderSince] = useState<string>("");
	const [savedAt, setSavedAt] = useState<string>("");
	const [busy, setBusy] = useState<boolean>(false);

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
	// NOTE: create_workbook is NOT on the SDK -- see the raw fetch in handleImport (FR-3).

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
	useEffect(() => {
		const releaseBeacon = () => {
			if (!lockMineRef.current || !workbookNameRef.current) return;
			const token =
				(window as any).frappe?.csrf_token || (window as any).csrf_token || "";
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

	const handleSave = useCallback(async () => {
		setBusy(true);
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
			// GZIP + MULTIPART, the ONE transport for save (FR-5). Same-origin fetch +
			// CSRF header (PM-6). This replaces the nested-JSON body entirely: nesting
			// the workbook as a JSON *string* escaped every quote (1.23x -> 25.91 MB for
			// Electrical) and blew past the site's 25 MiB limit; gzip takes the same
			// payload to a few MB. There is deliberately NO non-gzip fallback.
			const token =
				(window as any).frappe?.csrf_token || (window as any).csrf_token || "";
			const form = await buildWorkbookForm(JSON.stringify(sheets), {
				name: workbookNameRef.current,
			});
			const res = await fetch(`/api/method/${M}.save_workbook`, {
				method: "POST",
				headers: { "X-Frappe-CSRF-Token": token }, // no Content-Type: the browser sets the boundary
				body: form,
			});
			if (!res.ok) {
				// Surface the REAL Frappe message (keeps lock + Edit state intact).
				let msg = `Save failed (HTTP ${res.status}).`;
				try {
					const data = await res.json();
					if (data?._server_messages) {
						const parsed = JSON.parse(data._server_messages);
						msg =
							parsed
								.map((m: string) => {
									try {
										return JSON.parse(m).message;
									} catch {
										return String(m);
									}
								})
								.join(" ") || msg;
					} else if (typeof data?.message === "string") {
						msg = data.message;
					}
				} catch {
					/* non-JSON body -> keep the HTTP fallback */
				}
				throw new Error(msg);
			}
			setSavedAt(new Date().toLocaleTimeString());
		} catch (e: any) {
			setErrorMsg(e?.message || "Save failed.");
		} finally {
			setBusy(false);
		}
	}, []);

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

	const handleImport = useCallback(
		(file: File) => {
			setBusy(true);
			setErrorMsg("");
			window.LuckyExcel.transformExcelToLucky(file, async (exportJson: any) => {
				try {
					if (!exportJson?.sheets?.length) {
						throw new Error("The selected file has no readable sheets.");
					}
					// Import pipeline (FR-1 + FR-3), applied BEFORE persisting so the stored
					// workbook and the rendered one are identical:
					//  1. decodeSheetNames -- LuckyExcel HTML-escapes sheet names but NOT
					//     formula text, breaking every cross-sheet reference to a sheet whose
					//     name contains `&` (DIAG-6 Defect A).
					//  2. normalizeFormulas -- strip newlines and `++` from formula text; the
					//     engine cannot parse either (DIAG-6/FR-2 Defects D/E).
					const sheets = normalizeFormulas(decodeSheetNames(exportJson.sheets));
					//  3. attachDataValidations (DV-2) -- LuckyExcel drops every
					//     <dataValidation>, so re-read the SAME file with the vendored
					//     JSZip and attach the engine's per-cell dropdown records. Runs
					//     AFTER decodeSheetNames because sheet matching uses decoded names.
					//     Never throws: dropdowns are an enhancement, not the payload.
					const dvCount = await attachDataValidations(file, sheets);
					if (dvCount) console.log(`[pricing] attached ${dvCount} dropdown records`);
					// Created under THIS page's registry title, so the next load's
					// title-keyed selection finds it from this route and no other.
					//
					// GZIP + MULTIPART, the ONE transport for create (FR-5) -- identical to
					// handleSave. Persists the COMPACT form (PM-5: every save-shaped path goes
					// through serializeSheets); LuckyExcel's raw output carries the rebuilt
					// `data` grids and is far larger. Lossless: the engine rebuilds `data`
					// from `celldata` on load, and this is the same shape the workbook takes
					// after its first save.
					const token =
						(window as any).frappe?.csrf_token || (window as any).csrf_token || "";
					const form = await buildWorkbookForm(
						JSON.stringify(serializeSheets(sheets)),
						{ title: workbookTitle }
					);
					const res = await fetch(`/api/method/${M}.create_workbook`, {
						method: "POST",
						headers: { "X-Frappe-CSRF-Token": token }, // browser sets the multipart boundary
						body: form,
					});
					if (!res.ok) {
						let msg = `Import failed (HTTP ${res.status}).`;
						try {
							const data = await res.json();
							if (data?._server_messages) {
								const parsed = JSON.parse(data._server_messages);
								msg =
									parsed
										.map((m: string) => {
											try {
												return JSON.parse(m).message;
											} catch {
												return String(m);
											}
										})
										.join(" ") || msg;
							} else if (typeof data?.message === "string") {
								msg = data.message;
							}
						} catch {
							/* non-JSON body -> keep the HTTP fallback */
						}
						throw new Error(msg);
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
			});
		},
		[requestSheet, workbookTitle]
	);

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

	return (
		<div className="flex flex-col h-[calc(100vh-100px)]">
			<div className="flex flex-wrap items-center gap-2 p-2 border-b border-border">
				<h1 className="text-base font-semibold text-foreground mr-2">{workbookTitle}</h1>

				{status === "ready" && lock === "readonly" && (
					<Button size="sm" disabled={busy} onClick={handleEdit}>
						Edit
					</Button>
				)}
				{status === "ready" && lock === "readonly" && errorMsg && (
					// A failed checkout on a FREE lock: show the real error, Edit stays retryable.
					<span className="text-sm text-destructive">{errorMsg}</span>
				)}
				{status === "ready" && lock === "mine" && (
					<>
						<span className="text-sm text-emerald-600 font-medium">
							You hold the edit lock
						</span>
						<Button size="sm" disabled={busy} onClick={handleSave}>
							Save
						</Button>
						<Button size="sm" variant="outline" disabled={busy} onClick={handleRelease}>
							Release
						</Button>
						{savedAt && (
							<span className="text-xs text-muted-foreground">Saved at {savedAt}</span>
						)}
					</>
				)}
				{status === "ready" && lock === "locked-by-other" && (
					<span className="text-sm text-amber-600 font-medium">
						Locked by {holder} — read only
						{holderSince ? ` (since ${holderSince.slice(0, 16)} IST)` : ""}
					</span>
				)}
				{status === "ready" && lock === "readonly" && holder && (
					<span className="text-sm text-amber-600 font-medium">
						Currently held by {holder}
						{holderSince ? ` (since ${holderSince.slice(0, 16)} IST)` : ""}
					</span>
				)}
			</div>

			{status === "empty" ? (
				<div className="flex-1 flex items-center justify-center">
					<div className="text-center">
						<p className="text-muted-foreground mb-4">
							No <span className="font-medium">{workbookTitle}</span> workbook yet. Import an
							Excel file to get started.
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
									if (file) handleImport(file);
									e.target.value = "";
								}}
							/>
						</label>
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
		</div>
	);
}

export { PricingWorkbookPage as Component };
