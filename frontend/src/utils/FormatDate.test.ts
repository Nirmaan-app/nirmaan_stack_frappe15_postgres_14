import { describe, expect, it } from "vitest";
import { formatDate } from "./FormatDate";

/** What `formatDate` printed before it reused its formatters: three `toLocaleString` calls per date. */
const formatDateBefore = (dateString: Date | string) => {
  const date = new Date(dateString);
  return (
    date.toLocaleString("default", { day: "2-digit" }) + "-" +
    date.toLocaleString("default", { month: "short" }) + "-" +
    date.toLocaleString("default", { year: "numeric" })
  );
};

describe("formatDate reuses its formatters and prints exactly what it printed before", () => {
  it("prints a Frappe datetime, a date and a Date object as dd-Mon-yyyy", () => {
    expect(formatDate("2026-11-05 10:20:30.123456")).toBe(formatDateBefore("2026-11-05 10:20:30.123456"));
    expect(formatDate("2026-02-28")).toBe(formatDateBefore("2026-02-28"));
    const now = new Date();
    expect(formatDate(now)).toBe(formatDateBefore(now));
  });

  // Every 5th day (every month, every weekday) over 30 years: the old formatter is too slow to check every day.
  it("matches the old text across 30 years", () => {
    for (let day = 0; day < 30 * 366; day += 5) {
      const date = new Date(Date.UTC(2000, 0, 1) + day * 86_400_000 + (day % 24) * 3_600_000);
      expect(formatDate(date)).toBe(formatDateBefore(date));
    }
  });

  it("keeps the old text for a date it cannot read, rather than throwing", () => {
    expect(formatDate("not a date")).toBe("Invalid Date-Invalid Date-Invalid Date");
    expect(formatDate("not a date")).toBe(formatDateBefore("not a date"));
  });
});
