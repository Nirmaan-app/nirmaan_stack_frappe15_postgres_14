import { describe, expect, it } from "vitest";
import { TDS_REPOSITORY_PATH, whereAfterTdsItemDelete } from "./tdsRepositoryNavigation";

describe("whereAfterTdsItemDelete", () => {
  it("goes back in history when the item was opened from inside the app", () => {
    // React Router gives every in-app navigation a random key, e.g. "x7k2pq1a".
    expect(whereAfterTdsItemDelete("x7k2pq1a")).toEqual({ kind: "back" });
  });

  it("lands on the plain repository page when the item was opened by URL or a refresh", () => {
    // React Router keys the first page of a browser session "default".
    expect(whereAfterTdsItemDelete("default")).toEqual({ kind: "path", path: "/tds-repository" });
  });

  it("the repository path is the route the table lives on", () => {
    expect(TDS_REPOSITORY_PATH).toBe("/tds-repository");
  });
});
