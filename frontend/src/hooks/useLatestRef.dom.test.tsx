// @vitest-environment jsdom
//
// A callback created once (so what it is handed to never re-subscribes or re-renders for it) must still call the
// handler its parent passed last.
import { useCallback, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useLatestRef } from "./useLatestRef";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Fire = (n: number) => void;

function Subscriber({ onEvent, expose }: { onEvent: Fire; expose: (fire: Fire) => void }) {
  const onEventRef = useLatestRef(onEvent);
  const fire = useCallback((n: number) => onEventRef.current(n), [onEventRef]);
  useEffect(() => expose(fire), [expose, fire]);
  return null;
}

describe("useLatestRef", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("a callback made once calls the handler passed last, and stays the same callback", () => {
    const fires: Fire[] = [];
    const expose = (fire: Fire) => {
      fires.push(fire);
    };
    const first = vi.fn();
    const second = vi.fn();

    act(() => root.render(<Subscriber onEvent={first} expose={expose} />));
    act(() => root.render(<Subscriber onEvent={second} expose={expose} />));

    expect(fires).toHaveLength(1);
    fires[0](7);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(7);
  });
});
