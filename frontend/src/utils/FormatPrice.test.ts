import { describe, expect, it } from "vitest";
import { formatForReport, formatToCompactRupee, formatToRoundedIndianRupee } from "./FormatPrice";

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
    expect(formatToRoundedIndianRupee(-120.6)).toBe("-₹121");
    expect(formatToRoundedIndianRupee(-120.5)).toBe("-₹121");
  });

  it("puts a negative figure's sign before the rupee symbol (#1675): a card refund reads -₹802", () => {
    expect(formatToRoundedIndianRupee(-801.5)).toBe("-₹802");
    expect(formatToRoundedIndianRupee("-150000")).toBe("-₹1,50,000");
  });

  it("exports the same rounded figure to a report", () => {
    expect(formatForReport(3061.22)).toBe(3061);
    expect(formatForReport(0.3)).toBe(0);
    expect(formatForReport(-0.3)).toBe(0);
  });
});

describe("formatToCompactRupee: a short crore / lakh figure (the one owner, residence rule R1)", () => {
  it("shortens to Cr and L and keeps small amounts whole", () => {
    expect(formatToCompactRupee(32304860)).toBe("₹3.23 Cr");
    expect(formatToCompactRupee(427800)).toBe("₹4.28 L");
    expect(formatToCompactRupee(45000.4)).toBe("₹45,000");
    expect(formatToCompactRupee(0)).toBe("₹0");
  });
  it("switches at exactly a lakh and a crore", () => {
    expect(formatToCompactRupee(99999)).toBe("₹99,999");
    expect(formatToCompactRupee(100000)).toBe("₹1.00 L");
    expect(formatToCompactRupee(10000000)).toBe("₹1.00 Cr");
  });
  it("keeps the minus sign of a net-negative figure (credit notes)", () => {
    expect(formatToCompactRupee(-1500)).toBe("-₹1,500");
    expect(formatToCompactRupee(-250000)).toBe("-₹2.50 L");
  });
  it("treats null, undefined and NaN as 0", () => {
    expect(formatToCompactRupee(null)).toBe("₹0");
    expect(formatToCompactRupee(undefined)).toBe("₹0");
    expect(formatToCompactRupee(Number.NaN)).toBe("₹0");
  });
});
