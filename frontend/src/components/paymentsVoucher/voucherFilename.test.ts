import { describe, expect, it } from "vitest";

import { VOUCHER_UTR_MAX, buildVoucherFilename } from "./voucherFilename";

const base = { orderName: "PO-26-00123", paymentName: "PAY-00456", datePart: "20260914" };

describe("buildVoucherFilename", () => {
  it("keeps today's shape for a short UTR", () => {
    expect(buildVoucherFilename({ ...base, utr: "UTR 6002/1969" })).toBe(
      "PO-26-00123_PAY-00456_20260914__UTR60021969.pdf",
    );
  });

  it("keeps today's shape with no UTR", () => {
    expect(buildVoucherFilename({ ...base, utr: null })).toBe("PO-26-00123_PAY-00456_20260914_.pdf");
  });

  it("caps the UTR part for a long bank narration", () => {
    const narration = "MMT/IMPS/600219693408/PAYMENT TO VENDOR FOR SITE MATERIAL ".repeat(8);
    const name = buildVoucherFilename({ ...base, utr: narration });

    const utrPart = name.slice("PO-26-00123_PAY-00456_20260914__".length, -".pdf".length);
    expect(utrPart).toBe("MMTIMPS600219693408PAYMENTTOVENDORFORSITEMATERIAL".slice(0, VOUCHER_UTR_MAX));
    expect(name.length).toBeLessThan(120);
  });
});
