import { useLayoutEffect, useRef } from "react";

/**
 * The latest `value`, for a callback or effect that must read a prop or context as last rendered without being
 * recreated each time it changes. Written after each commit (a layout effect), never during render, so React
 * Doctor's no-ref-current-in-render holds (#1698). Read `.current` in callbacks and effects only: during a render
 * it still holds the previous value.
 */
export function useLatestRef<T>(value: T): { readonly current: T } {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}
