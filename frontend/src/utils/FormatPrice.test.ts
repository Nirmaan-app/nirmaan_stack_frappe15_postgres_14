import { describe, expect, it } from "vitest";
import { formatForReport, formatToRoundedIndianRupee } from "./FormatPrice";

describe("rupee figures round to the nearest rupee (#1543, owner ruling Q30-A)", () => {
  it("rounds a figure with paise down when under half a rupee", () => {
    expect(formatToRoundedIndianRupee(3061.22)).toBe("₹3,061");
  });

  it("shows a ₹0.30 Due as ₹0, so a fully paid Work Order never reads ₹1 due", () => {
    expect(formatToRoundedIndianRupee(0.3)).toBe("₹0");
  });

  it("rounds half a rupee and more up", () => {
    expect(formatToRoundedIndianRupee(3061.5)).toBe("₹3,062");
    expect(formatToRoundedIndianRupee("1999.7")).toBe("₹2,000");
  });

  it("rounds a negative (overpaid) figure the same way, and never reads -0", () => {
    expect(formatToRoundedIndianRupee(-0.3)).toBe("₹0");
    expect(formatToRoundedIndianRupee(-120.6)).toBe("₹-121");
    expect(formatToRoundedIndianRupee(-120.5)).toBe("₹-121");
  });

  it("exports the same rounded figure to a report", () => {
    expect(formatForReport(3061.22)).toBe(3061);
    expect(formatForReport(0.3)).toBe(0);
    expect(formatForReport(-0.3)).toBe(0);
  });
});
