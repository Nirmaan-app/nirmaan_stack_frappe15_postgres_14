import { describe, expect, it } from "vitest";

import { ellipsize } from "./ellipsize";

describe("ellipsize", () => {
  it("leaves a value that fits untouched", () => {
    expect(ellipsize("610415565123", 40)).toBe("610415565123");
  });

  it("shortens a long value to the limit, ending in an ellipsis", () => {
    const out = ellipsize("MMT/IMPS/600219693408/PAYMENT TO VENDOR FOR SITE MATERIAL", 20);
    expect(out).toBe("MMT/IMPS/6002196934…");
    expect(out.length).toBe(20);
  });

  it("passes blanks through", () => {
    expect(ellipsize("", 20)).toBe("");
    expect(ellipsize(null, 20)).toBe("");
    expect(ellipsize(undefined, 20)).toBe("");
  });
});
