// @vitest-environment jsdom
//
// #1665: the upload's "taking a little longer than usual" note counts from when the parse starts running, not
// from the upload. A parse that waits in the queue shows that it is waiting, and its wait never counts.
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useBoqWizardStore } from "@/zustand/useBoqWizardStore";
import { BoqDropZone } from "./BoqDropZone";
import type { UploadStatus } from "./boqUploadOperation";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TAKING_LONGER = "taking a little longer than usual";

describe("BoqDropZone: the taking-longer note", () => {
  let container: HTMLDivElement;
  let root: Root;
  const render = (status: UploadStatus) =>
    act(() => root.render(<BoqDropZone status={status} error={null} onUpload={vi.fn()} onReset={vi.fn()} />));
  const wait = (ms: number) => act(() => {
    vi.advanceTimersByTime(ms);
  });
  const text = () => container.textContent ?? "";

  beforeEach(() => {
    vi.useFakeTimers();
    useBoqWizardStore.getState().reset();
    useBoqWizardStore.getState().setDroppedFile({ name: "Tower_A.xlsx", size: 2048 });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it("does not count the time the parse waits in the queue", () => {
    render("uploading");
    wait(5_000);
    render("queued");
    expect(text()).toContain("Waiting in the queue");
    wait(60_000);
    expect(text()).not.toContain(TAKING_LONGER);

    render("parsing");
    wait(29_000);
    expect(text()).not.toContain(TAKING_LONGER);
    wait(2_000);
    expect(text()).toContain(TAKING_LONGER);
  });
});
