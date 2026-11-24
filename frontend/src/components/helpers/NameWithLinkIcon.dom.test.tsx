// @vitest-environment jsdom
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { NameWithLinkIcon } from "./NameWithLinkIcon";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(() => act(() => root.unmount()));

describe("NameWithLinkIcon", () => {
  it("shows the name and an icon link to the record", () => {
    act(() =>
      root.render(
        <MemoryRouter>
          <NameWithLinkIcon label="Wakefit Punjab Revamp" to="/projects/PROJ-0001?page=overview" hint="View Project" />
        </MemoryRouter>
      )
    );
    expect(container.textContent).toBe("Wakefit Punjab Revamp");
    const links = [...container.querySelectorAll("a")];
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("href")).toBe("/projects/PROJ-0001?page=overview");
    expect(links[0].getAttribute("aria-label")).toBe("View Project");
  });

  it("shows only the name when there is nowhere to link", () => {
    act(() =>
      root.render(
        <MemoryRouter>
          <NameWithLinkIcon label="Mahmood" hint="View Vendor" />
        </MemoryRouter>
      )
    );
    expect(container.textContent).toBe("Mahmood");
    expect(container.querySelectorAll("a")).toHaveLength(0);
  });
});
