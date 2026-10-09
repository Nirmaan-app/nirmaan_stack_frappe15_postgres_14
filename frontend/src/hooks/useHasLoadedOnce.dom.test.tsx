// @vitest-environment jsdom
//
// The defect: list pages gated their skeleton on `isLoading && !rows.length`. A search with no match
// leaves rows empty, so the next keystroke's refetch swapped the whole DataTable for the skeleton,
// unmounting the search box and dropping the user's cursor. The search box must survive every
// refetch after the first load.
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useHasLoadedOnce } from "./useHasLoadedOnce";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The shape every list page uses: skeleton on first load, otherwise the table with its search box.
function ListPage({ isLoading, rows }: { isLoading: boolean; rows: string[] }) {
  const hasLoadedOnce = useHasLoadedOnce(isLoading);
  return !hasLoadedOnce && isLoading && !rows.length ? (
    <div data-testid="skeleton" />
  ) : (
    <input data-testid="search" />
  );
}

describe("useHasLoadedOnce on a list page", () => {
  let container: HTMLDivElement;
  let root: Root;
  const render = (isLoading: boolean, rows: string[]) =>
    act(() => root.render(<ListPage isLoading={isLoading} rows={rows} />));
  const search = () => container.querySelector('[data-testid="search"]');
  const skeleton = () => container.querySelector('[data-testid="skeleton"]');

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("shows the skeleton during the first load", () => {
    render(true, []);
    expect(skeleton()).not.toBeNull();
    expect(search()).toBeNull();
  });

  it("keeps the same search box through a refetch that starts from no rows", () => {
    render(true, []); // first load
    render(false, ["P-1"]);
    const input = search();
    expect(input).not.toBeNull();

    render(true, ["P-1"]); // user types a name with no match
    render(false, []);
    expect(search()).toBe(input);

    render(true, []); // the next keystroke refetches from an empty list
    expect(skeleton()).toBeNull();
    expect(search()).toBe(input);

    render(false, []);
    expect(search()).toBe(input);
  });
});
