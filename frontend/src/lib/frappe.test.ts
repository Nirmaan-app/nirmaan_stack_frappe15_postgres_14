// The typed SDK module (ADR-0049). Two kinds of check:
//  - runtime (vitest): every export is the SDK's own value, so the module changes no behaviour;
//  - types (`yarn typecheck`, which compiles this file): a call without a type argument gives `unknown`, a call
//    with one gives that type. A wrong `expectTypeOf` is a tsc error, so typecheck fails, not vitest.
// No update-doc hook here: residence rule F5 counts every file that names it.
// The hooks are only called inside custom hooks (`use...`) that never run: their return types are read, no render.
import * as sdk from "frappe-react-sdk";
import { describe, expect, expectTypeOf, it } from "vitest";
import * as frappe from "./frappe";
import {
  useFrappeCreateDoc,
  useFrappeGetCall,
  useFrappeGetDoc,
  useFrappeGetDocList,
  useFrappePostCall,
  useSocketEventListener,
  type FrappeDoc,
} from "./frappe";

// The SDK's three listener hooks (`useFrappe…EventListener`) are not exported (#1670); the module's own safe
// listeners stand in their place (frappeListeners.dom.test.tsx).
const isSdkListener = (name: string) => name.startsWith("useFrappe") && name.endsWith("EventListener");
const SAFE_LISTENERS = ["useSocketEventListener", "useDocTypeEventListener", "useDocumentEventListener"];

interface Customer {
  customer_name: string;
}

describe("the typed SDK module", () => {
  it("exports every SDK value but the three listener hooks as the SDK's own, unchanged, plus the safe listeners", () => {
    // vitest's node runner loads the SDK's CommonJS build: its namespace lists only `default`, which holds the
    // named exports (named access on `sdk` still works through vitest's interop).
    const sdkDefault = (sdk as unknown as { default?: Record<string, unknown> }).default;
    const allSdkNames = Object.keys(sdkDefault ?? sdk).filter((name) => name !== "default");
    expect(allSdkNames.filter(isSdkListener)).toHaveLength(3);
    const sdkNames = allSdkNames.filter((name) => !isSdkListener(name));
    expect(sdkNames.length).toBeGreaterThan(20);
    expect(Object.keys(frappe).sort()).toEqual([...sdkNames, ...SAFE_LISTENERS].sort());
    for (const name of sdkNames) {
      expect(frappe[name as keyof typeof frappe], name).toBe(sdk[name as keyof typeof sdk]);
      expect(frappe[name as keyof typeof frappe], name).toBeDefined();
    }
  });

  it("types data as unknown when the call passes no type argument", () => {
    const useCallData = () => useFrappeGetCall("nirmaan_stack.api.x.y").data;
    expectTypeOf<ReturnType<typeof useCallData>>().toEqualTypeOf<unknown>();

    const useListData = () => useFrappeGetDocList("Customers").data;
    expectTypeOf<ReturnType<typeof useListData>>().toEqualTypeOf<unknown[] | undefined>();

    // A document always carries Frappe's standard fields (name, owner, ...); nothing else is known.
    const useDocData = () => useFrappeGetDoc("Customers", "CUS-0001").data;
    expectTypeOf<ReturnType<typeof useDocData>>().toEqualTypeOf<FrappeDoc<unknown> | undefined>();
    // @ts-expect-error -- a field the caller did not type is not readable
    const useUntypedField = () => useFrappeGetDoc("Customers", "CUS-0001").data?.customer_name;
    void useUntypedField;

    const usePostCall = () => useFrappePostCall("nirmaan_stack.api.x.y").call;
    expectTypeOf<ReturnType<ReturnType<typeof usePostCall>>>().toEqualTypeOf<Promise<unknown>>();

    const useCreateDoc = () => useFrappeCreateDoc().createDoc;
    expectTypeOf<ReturnType<ReturnType<typeof useCreateDoc>>>().toEqualTypeOf<Promise<FrappeDoc<unknown>>>();

    const useListener = () =>
      useSocketEventListener("po:new", (eventData) => {
        expectTypeOf(eventData).toEqualTypeOf<unknown>();
      });
    void useListener;
  });

  it("types data as the type argument when the call passes one", () => {
    const useCallData = () => useFrappeGetCall<{ message: Customer[] }>("nirmaan_stack.api.x.y").data;
    expectTypeOf<ReturnType<typeof useCallData>>().toEqualTypeOf<{ message: Customer[] } | undefined>();

    const useListData = () => useFrappeGetDocList<Customer>("Customers").data;
    expectTypeOf<ReturnType<typeof useListData>>().toEqualTypeOf<Customer[] | undefined>();

    const useDocData = () => useFrappeGetDoc<Customer>("Customers", "CUS-0001").data;
    expectTypeOf<ReturnType<typeof useDocData>>().toEqualTypeOf<FrappeDoc<Customer> | undefined>();

    const usePostCall = () => useFrappePostCall<{ message: string }>("nirmaan_stack.api.x.y").call;
    expectTypeOf<ReturnType<ReturnType<typeof usePostCall>>>().toEqualTypeOf<Promise<{ message: string }>>();
  });
});
