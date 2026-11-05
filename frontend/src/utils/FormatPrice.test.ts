import { describe, expect, it } from "vitest";
import formatToIndianRupee, { formatForReport, formatToApproxLakhs, formatToRoundedIndianRupee } from "./FormatPrice";

describe("the rupee formatters reuse one formatter and print exactly what toLocaleString printed", () => {
  const twoDp = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const amounts = [1, 0.005, 0.1 + 0.2, -120.5, 3061.22, 1234567.891, 99999999.999, -3061.22, 1e15];

  it("formatToIndianRupee: two decimals in Indian grouping", () => {
    for (const n of amounts) expect(formatToIndianRupee(n)).toBe(`₹${twoDp(n)}`);
    expect(formatToIndianRupee(1234567.891)).toBe("₹12,34,567.89");
  });

  it("formatToRoundedIndianRupee: whole rupees in Indian grouping", () => {
    for (const n of amounts) expect(formatToRoundedIndianRupee(n)).toBe(`₹${formatForReport(n).toLocaleString("en-IN")}`);
    expect(formatToRoundedIndianRupee(1234567.891)).toBe("₹12,34,568");
  });

  it("formatToApproxLakhs: lakhs with two decimals", () => {
    expect(formatToApproxLakhs(250000)).toBe("₹2.50 L");
    expect(formatToApproxLakhs(123456789)).toBe(`₹${twoDp(1234.57)} L`);
  });
});

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
