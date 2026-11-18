/**
 * The app's one import point for `frappe-react-sdk` (ADR-0049). Import SDK hooks, `FrappeProvider`,
 * `FrappeContext`, `useSWRConfig` and the SDK types from `@/lib/frappe`; oxlint bans importing the SDK anywhere
 * else.
 *
 * Every SDK hook is declared `<T = any>`, so a call that passes no type returns `any` that no rule sees. Here each
 * generic hook is re-declared with `T` defaulting to `unknown`: a call without a type argument gives `unknown` data
 * (or `FrappeDoc<unknown>`, Frappe's standard fields only, for a document), and a call with one gives that type.
 * Pass the type, or narrow the `unknown`.
 *
 * Pure re-typing: every export is the SDK's own function or value (`frappe.test.ts` checks each one is identical),
 * so no hook behaves differently, and a test that mocks `frappe-react-sdk` still reaches every caller through here.
 * The parameter and return types are read from the SDK's own declarations, so an SDK upgrade cannot drift them.
 *
 * Not re-typed: SWR's own `useSWR`, `useSWRInfinite`, `preload` and `useSWRConfig().mutate` keep SWR's typing
 * (they infer `Data` from the fetcher you pass).
 */
import * as sdk from "frappe-react-sdk";

// Listed by name, never `export *`: vitest's node runner loads the SDK's CommonJS build, from which `export *`
// re-exports nothing, so a unit test would get `undefined` where the app gets the SDK's value.
export {
  FrappeContext,
  FrappeProvider,
  getDocListQueryString,
  getRequestURL,
  preload,
  useFrappeAuth,
  useFrappeDeleteDoc,
  useFrappeDocTypeEventListener,
  useFrappeDocumentEventListener,
  useSWR,
  useSWRConfig,
  useSWRInfinite,
  useSearch,
} from "frappe-react-sdk";
export type {
  AuthCredentials,
  AuthResponse,
  DocTypeListUpdateEventData,
  DocumentUpdateEventData,
  FileArgs,
  Filter,
  FrappeConfig,
  FrappeDoc,
  FrappeError,
  FrappeFileUploadResponse,
  GetDocListArgs,
  Key,
  OTPCredentials,
  SearchResult,
  SWRConfiguration,
  SWRResponse,
  TokenParams,
  UserPassCredentials,
  ViewerEventData,
} from "frappe-react-sdk";

type Sdk = typeof sdk;

/** `useFrappeGetDoc` with `T` defaulting to `unknown`. The third argument is the SWR key (`id ? undefined : null`). */
export const useFrappeGetDoc: <T = unknown>(
  ...args: Parameters<Sdk["useFrappeGetDoc"]>
) => ReturnType<typeof sdk.useFrappeGetDoc<T>> = sdk.useFrappeGetDoc;

/** `useFrappePrefetchDoc` with `T` defaulting to `unknown`. */
export const useFrappePrefetchDoc: <T = unknown>(
  ...args: Parameters<Sdk["useFrappePrefetchDoc"]>
) => ReturnType<typeof sdk.useFrappePrefetchDoc<T>> = sdk.useFrappePrefetchDoc;

/** `useFrappeGetDocList` with `T` defaulting to `unknown`. */
export const useFrappeGetDocList: <T = unknown, K = sdk.FrappeDoc<T>>(
  ...args: Parameters<typeof sdk.useFrappeGetDocList<T, K>>
) => ReturnType<typeof sdk.useFrappeGetDocList<T, K>> = sdk.useFrappeGetDocList;

/** `useFrappePrefetchDocList` with `T` defaulting to `unknown`. */
export const useFrappePrefetchDocList: <T = unknown, K = sdk.FrappeDoc<T>>(
  ...args: Parameters<typeof sdk.useFrappePrefetchDocList<T, K>>
) => ReturnType<typeof sdk.useFrappePrefetchDocList<T, K>> = sdk.useFrappePrefetchDocList;

/** `useFrappeCreateDoc` with `T` defaulting to `unknown`. */
export const useFrappeCreateDoc: <T = unknown>() => ReturnType<typeof sdk.useFrappeCreateDoc<T>> =
  sdk.useFrappeCreateDoc;

/** `useFrappeUpdateDoc` with `T` defaulting to `unknown`. */
export const useFrappeUpdateDoc: <T = unknown>() => ReturnType<typeof sdk.useFrappeUpdateDoc<T>> =
  sdk.useFrappeUpdateDoc;

/** `useFrappeGetDocCount` with `T` defaulting to `unknown`. */
export const useFrappeGetDocCount: <T = unknown>(
  ...args: Parameters<typeof sdk.useFrappeGetDocCount<T>>
) => ReturnType<typeof sdk.useFrappeGetDocCount<T>> = sdk.useFrappeGetDocCount;

/** `useFrappePrefetchDocCount` with `T` defaulting to `unknown`. */
export const useFrappePrefetchDocCount: <T = unknown>(
  ...args: Parameters<typeof sdk.useFrappePrefetchDocCount<T>>
) => ReturnType<typeof sdk.useFrappePrefetchDocCount<T>> = sdk.useFrappePrefetchDocCount;

/** `useFrappeGetCall` with `T` defaulting to `unknown`. */
export const useFrappeGetCall: <T = unknown>(
  ...args: Parameters<Sdk["useFrappeGetCall"]>
) => ReturnType<typeof sdk.useFrappeGetCall<T>> = sdk.useFrappeGetCall;

/** `useFrappePrefetchCall` with `T` defaulting to `unknown`. */
export const useFrappePrefetchCall: <T = unknown>(
  ...args: Parameters<Sdk["useFrappePrefetchCall"]>
) => ReturnType<typeof sdk.useFrappePrefetchCall<T>> = sdk.useFrappePrefetchCall;

/** `useFrappePostCall` with `T` defaulting to `unknown`. */
export const useFrappePostCall: <T = unknown>(
  ...args: Parameters<Sdk["useFrappePostCall"]>
) => ReturnType<typeof sdk.useFrappePostCall<T>> = sdk.useFrappePostCall;

/** `useFrappePutCall` with `T` defaulting to `unknown`. */
export const useFrappePutCall: <T = unknown>(
  ...args: Parameters<Sdk["useFrappePutCall"]>
) => ReturnType<typeof sdk.useFrappePutCall<T>> = sdk.useFrappePutCall;

/** `useFrappeDeleteCall` with `T` defaulting to `unknown`. */
export const useFrappeDeleteCall: <T = unknown>(
  ...args: Parameters<Sdk["useFrappeDeleteCall"]>
) => ReturnType<typeof sdk.useFrappeDeleteCall<T>> = sdk.useFrappeDeleteCall;

/** `useFrappeFileUpload` with `T` (the upload's `otherData`) defaulting to `unknown`. */
export const useFrappeFileUpload: <T = unknown>() => ReturnType<typeof sdk.useFrappeFileUpload<T>> =
  sdk.useFrappeFileUpload;

// Event listeners. #1670 (open on 2026-11-12) replaces the SDK's listener hooks with a safe wrapper that removes
// only its own handler on unmount. When it lands, export that wrapper here, stop exporting the three raw hooks
// (`useFrappeEventListener` below, `useFrappeDocTypeEventListener` and `useFrappeDocumentEventListener` above), and
// let this module's lint ban stand in for #1670's check-script rule on raw listener imports.

/** `useFrappeEventListener` with the event data `T` defaulting to `unknown`. */
export const useFrappeEventListener: <T = unknown>(
  ...args: Parameters<typeof sdk.useFrappeEventListener<T>>
) => void = sdk.useFrappeEventListener;
